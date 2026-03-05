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
	version           = "1.2.0"
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

type heartbeatResponse struct {
	OK        bool       `json:"ok"`
	XrayNodes []xrayNode `json:"xrayNodes,omitempty"`
}

func sendHeartbeat(cfg *Config, m *Metrics, traffic []nodeTrafficStat) ([]xrayNode, error) {
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
	return hbResp.XrayNodes, nil
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("启动失败: %v", err)
	}

	log.Printf("NextPanel Agent v%s 启动，面板地址: %s", version, cfg.ServerURL)

	var xrayNodes []xrayNode

	for {
		m, err := collectMetrics()
		if err != nil {
			log.Printf("采集指标失败: %v", err)
		} else {
			traffic := collectNodeTraffic(xrayNodes)
			newNodes, err := sendHeartbeat(cfg, m, traffic)
			if err != nil {
				log.Printf("心跳发送失败: %v", err)
			} else {
				xrayNodes = newNodes
				log.Printf("心跳已发送 CPU=%.1f%% MEM=%.1f%% DISK=%.1f%% xrayNodes=%d",
					m.CPU, m.Mem, m.Disk, len(xrayNodes))
			}
		}
		time.Sleep(heartbeatInterval)
	}
}
