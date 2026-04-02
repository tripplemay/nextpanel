package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

const (
	version           = "1.5.5"
	heartbeatInterval = 10 * time.Second
	httpTimeout       = 8 * time.Second
)

var httpClient = &http.Client{Timeout: httpTimeout}

type nodeStatus struct {
	NodeID string `json:"nodeId"`
	Status string `json:"status"` // RUNNING | STOPPED | ERROR
}

type heartbeatPayload struct {
	AgentToken    string            `json:"agentToken"`
	AgentVersion  string            `json:"agentVersion"`
	CPU           float64           `json:"cpu"`
	Mem           float64           `json:"mem"`
	Disk          float64           `json:"disk"`
	NetworkIn     uint64            `json:"networkIn"`
	NetworkOut    uint64            `json:"networkOut"`
	NodeTraffic   []nodeTrafficStat `json:"nodeTraffic,omitempty"`
	NodeStatuses  []nodeStatus      `json:"nodeStatuses,omitempty"`
}

type ipCheckTask struct {
	ServerID string `json:"serverId"`
}

type updateCommand struct {
	Version     string `json:"version"`
	DownloadURL string `json:"downloadUrl"`
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
		if len(fields) < 3 {
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
		if fields[2] == "running" {
			status = "RUNNING"
		} else if fields[2] == "failed" {
			status = "ERROR"
		}
		statuses = append(statuses, nodeStatus{NodeID: name, Status: status})
	}
	return statuses
}

func sendHeartbeat(cfg *Config, m *Metrics, traffic []nodeTrafficStat, chainStatuses []nodeStatus) (*heartbeatResponse, error) {
	payload := heartbeatPayload{
		AgentToken:    cfg.AgentToken,
		AgentVersion:  version,
		CPU:           m.CPU,
		Mem:           m.Mem,
		Disk:          m.Disk,
		NetworkIn:     m.NetworkIn,
		NetworkOut:    m.NetworkOut,
		NodeTraffic:   traffic,
		NodeStatuses:  chainStatuses,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	url := strings.TrimRight(cfg.ServerURL, "/") + "/api/agent/heartbeat"
	resp, err := httpClient.Post(url, "application/json", bytes.NewReader(body))
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
	return &hbResp, nil
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("启动失败: %v", err)
	}

	log.Printf("NextPanel Agent v%s 启动，面板地址: %s", version, cfg.ServerURL)

	ensureNexttrace()

	var xrayNodes []xrayNode
	var ipCheckRunning bool
	var selfUpdateRunning bool

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
				xrayNodes = hbResp.XrayNodes
				log.Printf("心跳已发送 CPU=%.1f%% MEM=%.1f%% DISK=%.1f%% xrayNodes=%d",
					m.CPU, m.Mem, m.Disk, len(xrayNodes))

				// Run IP check task if assigned and not already running
				if hbResp.IpCheckTask != nil && !ipCheckRunning {
					ipCheckRunning = true
					go func(serverId string) {
						defer func() { ipCheckRunning = false }()
						runIpCheck(cfg, serverId)
					}(hbResp.IpCheckTask.ServerID)
				}

				// Self-update if server delivered an update command
				if hbResp.UpdateCommand != nil && !selfUpdateRunning {
					cmd := hbResp.UpdateCommand
					if cmd.Version != version {
						selfUpdateRunning = true
						go func(ver, url string) {
							log.Printf("收到更新指令：v%s → v%s，开始自更新...", version, ver)
							if err := selfUpdate(url); err != nil {
								log.Printf("自更新失败: %v", err)
								selfUpdateRunning = false
							}
							// selfUpdate exits the process on success; PM2 restarts it
						}(cmd.Version, cmd.DownloadURL)
					}
				}
			}
		}
		time.Sleep(heartbeatInterval)
	}
}
