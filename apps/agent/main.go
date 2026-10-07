package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

const (
	version           = "1.7.0"
	heartbeatInterval = 10 * time.Second
	httpTimeout       = 8 * time.Second
)

var httpClient = &http.Client{
	Timeout:       httpTimeout,
	CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
	Transport: &http.Transport{
		DisableKeepAlives: true,
	},
}

type nodeStatus struct {
	NodeID string `json:"nodeId"`
	Status string `json:"status"` // RUNNING | STOPPED | ERROR
}

type heartbeatPayload struct {
	AgentToken   string            `json:"agentToken"`
	AgentVersion string            `json:"agentVersion"`
	Architecture string            `json:"architecture"`
	CPU          float64           `json:"cpu"`
	Mem          float64           `json:"mem"`
	Disk         float64           `json:"disk"`
	NetworkIn    uint64            `json:"networkIn"`
	NetworkOut   uint64            `json:"networkOut"`
	NodeTraffic  []nodeTrafficStat `json:"nodeTraffic,omitempty"`
	NodeStatuses []nodeStatus      `json:"nodeStatuses,omitempty"`
}

type ipCheckTask struct {
	ServerID string `json:"serverId"`
}

type updateCommand struct {
	Version     string `json:"version"`
	DownloadURL string `json:"downloadUrl"`
	SHA256      string `json:"sha256"`
}

type heartbeatResponse struct {
	OK            bool           `json:"ok"`
	XrayNodes     []xrayNode     `json:"xrayNodes,omitempty"`
	IpCheckTask   *ipCheckTask   `json:"ipCheckTask,omitempty"`
	UpdateCommand *updateCommand `json:"updateCommand,omitempty"`
}

// discoverChainServices finds all nextpanel-chain-* systemd services and returns their statuses.
func discoverChainServices() []nodeStatus {
	out, err := exec.Command(
		"systemctl", "list-units", "--type=service", "--plain", "--no-legend",
		"--all", "nextpanel-chain-*",
	).Output()
	if err != nil {
		return nil
	}
	var statuses []nodeStatus
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		// systemctl list-units columns: UNIT LOAD ACTIVE SUB [DESCRIPTION...]
		if len(fields) < 4 {
			continue
		}
		// fields[0] = "nextpanel-chain-<nodeId>.service"
		name := fields[0]
		name = strings.TrimPrefix(name, "nextpanel-chain-")
		name = strings.TrimSuffix(name, ".service")
		if name == "" {
			continue
		}
		status := "STOPPED"
		if fields[3] == "running" {
			status = "RUNNING"
		} else if fields[3] == "failed" {
			status = "ERROR"
		}
		statuses = append(statuses, nodeStatus{NodeID: name, Status: status})
	}
	return statuses
}

func sendHeartbeat(cfg *Config, m *Metrics, traffic []nodeTrafficStat, chainStatuses []nodeStatus) (*heartbeatResponse, error) {
	payload := heartbeatPayload{
		AgentToken:   cfg.AgentToken,
		AgentVersion: version,
		Architecture: runtime.GOARCH,
		CPU:          m.CPU,
		Mem:          m.Mem,
		Disk:         m.Disk,
		NetworkIn:    m.NetworkIn,
		NetworkOut:   m.NetworkOut,
		NodeTraffic:  traffic,
		NodeStatuses: chainStatuses,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	// Never prefer an insecure direct link over the authenticated panel connection.
	baseURL := cfg.ServerURL
	if cfg.DirectURL != "" && (strings.HasPrefix(cfg.DirectURL, "https://") || !strings.HasPrefix(cfg.ServerURL, "https://")) {
		baseURL = cfg.DirectURL
	}
	url := strings.TrimRight(baseURL, "/") + "/api/agent/heartbeat"
	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(body))
	if err != nil && cfg.DirectURL != "" && cfg.DirectURL != cfg.ServerURL {
		// Preserve telemetry failover; plaintext responses still cannot authorize updates.
		fallback := cfg.DirectURL
		if baseURL == cfg.DirectURL {
			fallback = cfg.ServerURL
		}
		url = strings.TrimRight(fallback, "/") + "/api/agent/heartbeat"
		resp, err = httpClient.Post(url, "application/json", bytes.NewReader(body))
	}
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("服务端返回 %d", resp.StatusCode)
	}

	var hbResp heartbeatResponse
	if err := json.NewDecoder(resp.Body).Decode(&hbResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	if !hbResp.OK {
		return nil, fmt.Errorf("heartbeat was not acknowledged")
	}
	if resp.TLS == nil || len(resp.TLS.VerifiedChains) == 0 {
		hbResp.UpdateCommand = nil
	}
	return &hbResp, nil
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Println(version)
		return
	}
	if len(os.Args) == 3 && os.Args[1] == "--rollback" {
		backup, err := os.Executable()
		if err == nil {
			err = restorePreviousExecutable(backup, os.Args[2])
		}
		if err != nil {
			log.Fatalf("rollback failed: %v", err)
		}
		return
	}
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("启动失败: %v", err)
	}

	if cfg.DirectURL != "" {
		log.Printf("NextPanel Agent v%s 启动，直连: %s（备用: %s）", version, cfg.DirectURL, cfg.ServerURL)
	} else {
		log.Printf("NextPanel Agent v%s 启动，面板地址: %s", version, cfg.ServerURL)
	}

	ensureNexttrace()

	var xrayNodes []xrayNode
	var ipCheckRunning atomic.Bool
	var selfUpdateRunning atomic.Bool
	var startupConfirmed bool

	for {
		m, err := collectMetrics()
		if err != nil {
			log.Printf("采集指标失败: %v", err)
		} else {
			traffic := collectNodeTraffic(xrayNodes)
			chainStatuses := discoverChainServices()
			hbResp, err := sendHeartbeat(cfg, m, traffic, chainStatuses)
			if err != nil {
				log.Printf("心跳发送失败: %v", err)
			} else {
				if !startupConfirmed {
					if err := confirmSelfUpdate(); err != nil {
						log.Printf("update confirmation failed: %v", err)
					} else {
						startupConfirmed = true
					}
				}
				xrayNodes = hbResp.XrayNodes
				log.Printf("心跳已发送 CPU=%.1f%% MEM=%.1f%% DISK=%.1f%% xrayNodes=%d",
					m.CPU, m.Mem, m.Disk, len(xrayNodes))

				// Run IP check task if assigned and not already running
				if hbResp.IpCheckTask != nil && ipCheckRunning.CompareAndSwap(false, true) {
					go func(serverId string) {
						defer func() { ipCheckRunning.Store(false) }()
						runIpCheck(cfg, serverId)
					}(hbResp.IpCheckTask.ServerID)
				}

				// Self-update if server delivered an update command
				if hbResp.UpdateCommand != nil && hbResp.UpdateCommand.Version != version && selfUpdateRunning.CompareAndSwap(false, true) {
					cmd := hbResp.UpdateCommand
					if cmd.Version != version {
						go func(ver, url, digest string) {
							defer selfUpdateRunning.Store(false)
							log.Printf("收到更新指令：v%s → v%s，开始自更新...", version, ver)
							if err := selfUpdate(url, digest, ver); err != nil {
								log.Printf("自更新失败: %v", err)
							}
							// selfUpdate exits the process on success; systemd restarts it
						}(cmd.Version, cmd.DownloadURL, cmd.SHA256)
					}
				}
			}
		}
		time.Sleep(heartbeatInterval)
	}
}
