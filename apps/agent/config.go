package main

import (
	"encoding/json"
	"fmt"
	"os"
)

const configPath = "/etc/nextpanel/agent.json"

type Config struct {
	ServerURL  string `json:"serverUrl"`
	AgentToken string `json:"agentToken"`
}

func loadConfig() (*Config, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败 (%s): %w", configPath, err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %w", err)
	}
	if cfg.ServerURL == "" {
		return nil, fmt.Errorf("配置文件缺少 serverUrl")
	}
	if cfg.AgentToken == "" {
		return nil, fmt.Errorf("配置文件缺少 agentToken")
	}
	return &cfg, nil
}
