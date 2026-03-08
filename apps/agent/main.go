package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

const (
	version           = "1.5.0"
	heartbeatInterval = 10 * time.Second
)

type heartbeatPayload struct {
	AgentToken   string            `json:"agentToken"`
	AgentVersion string            `json:"agentVersion"`
	CPU          float64           `json:"cpu"`
	Mem          float64           `json:"mem"`
	Disk         float64           `json:"disk"`
	NetworkIn    uint64            `json:"networkIn"`
	NetworkOut   uint64            `json:"networkOut"`
	NodeTraffic  []nodeTrafficStat `json:"nodeTraffic,omitempty"`
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

func sendHeartbeat(cfg *Config, m *Metrics, traffic []nodeTrafficStat) (*heartbeatResponse, error) {
	payload := heartbeatPayload{
		AgentToken:   cfg.AgentToken,
		AgentVersion: version,
		CPU:          m.CPU,
		Mem:          m.Mem,
		Disk:         m.Disk,
		NetworkIn:    m.NetworkIn,
		NetworkOut:   m.NetworkOut,
		NodeTraffic:  traffic,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	url := strings.TrimRight(cfg.ServerURL, "/") + "/api/agent/heartbeat"
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
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

	var xrayNodes []xrayNode
	var ipCheckRunning bool
	var selfUpdateRunning bool

	for {
		m, err := collectMetrics()
		if err != nil {
			log.Printf("采集指标失败: %v", err)
		} else {
			traffic := collectNodeTraffic(xrayNodes)
			hbResp, err := sendHeartbeat(cfg, m, traffic)
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
