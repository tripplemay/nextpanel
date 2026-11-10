package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

type systemInfoValues struct {
	CPUModel             string `json:"cpuModel,omitempty"`
	CPULogicalCores      int    `json:"cpuLogicalCores,omitempty"`
	Architecture         string `json:"architecture,omitempty"`
	MemoryTotalBytes     uint64 `json:"memoryTotalBytes,omitempty"`
	RootTotalBytes       uint64 `json:"rootTotalBytes,omitempty"`
	RootFsType           string `json:"rootFsType,omitempty"`
	OSName               string `json:"osName,omitempty"`
	OSVersion            string `json:"osVersion,omitempty"`
	KernelVersion        string `json:"kernelVersion,omitempty"`
	VirtualizationSystem string `json:"virtualizationSystem,omitempty"`
	VirtualizationRole   string `json:"virtualizationRole,omitempty"`
}

type systemInfoPayload struct {
	AgentToken    string           `json:"agentToken"`
	AgentVersion  string           `json:"agentVersion"`
	SchemaVersion int              `json:"schemaVersion"`
	CollectedAt   time.Time        `json:"collectedAt"`
	Values        systemInfoValues `json:"values"`
}

type systemInfoSources struct {
	cpuInfo        func(context.Context) ([]cpu.InfoStat, error)
	cpuCount       func(context.Context, bool) (int, error)
	memory         func(context.Context) (*mem.VirtualMemoryStat, error)
	root           func(context.Context, string) (*disk.UsageStat, error)
	platform       func(context.Context) (string, string, string, error)
	kernel         func(context.Context) (string, error)
	virtualization func(context.Context) (string, string, error)
}

var localSystemInfo = systemInfoSources{
	cpu.InfoWithContext, cpu.CountsWithContext, mem.VirtualMemoryWithContext,
	disk.UsageWithContext, host.PlatformInformationWithContext, host.KernelVersionWithContext,
	host.VirtualizationWithContext,
}

func inventoryText(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func collectSystemInfo(ctx context.Context, sources systemInfoSources) systemInfoValues {
	values := systemInfoValues{Architecture: runtime.GOARCH}
	if infos, err := sources.cpuInfo(ctx); err == nil {
		models := make([]string, 0)
		seen := make(map[string]bool)
		for _, info := range infos {
			model := inventoryText(info.ModelName, 256)
			if model != "" && !seen[model] {
				models = append(models, model)
				seen[model] = true
			}
		}
		values.CPUModel = inventoryText(strings.Join(models, " / "), 256)
	}
	if count, err := sources.cpuCount(ctx, true); err == nil && count > 0 && count <= 1048576 {
		values.CPULogicalCores = count
	}
	const maxSafeInteger = uint64(9007199254740991)
	if stat, err := sources.memory(ctx); err == nil && stat != nil && stat.Total <= maxSafeInteger {
		values.MemoryTotalBytes = stat.Total
	}
	if stat, err := sources.root(ctx, "/"); err == nil && stat != nil {
		if stat.Total <= maxSafeInteger {
			values.RootTotalBytes = stat.Total
		}
		values.RootFsType = inventoryText(stat.Fstype, 64)
	}
	if platform, _, release, err := sources.platform(ctx); err == nil {
		values.OSName = inventoryText(platform, 128)
		values.OSVersion = inventoryText(release, 128)
	}
	if kernel, err := sources.kernel(ctx); err == nil {
		values.KernelVersion = inventoryText(kernel, 128)
	}
	if system, role, err := sources.virtualization(ctx); err == nil {
		// An empty result is not proof of bare metal.
		values.VirtualizationSystem = inventoryText(system, 64)
		switch role {
		case "host", "guest":
			values.VirtualizationRole = role
		}
	}
	return values
}

func reportSystemInfo(ctx context.Context, cfg *Config, payload systemInfoPayload, client *http.Client) (int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	baseURL := cfg.ServerURL
	if cfg.DirectURL != "" && (strings.HasPrefix(cfg.DirectURL, "https://") || !strings.HasPrefix(cfg.ServerURL, "https://")) {
		baseURL = cfg.DirectURL
	}
	post := func(base string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+"/api/agent/system-info", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		return client.Do(req)
	}
	resp, err := post(baseURL)
	if err != nil && cfg.DirectURL != "" && cfg.DirectURL != cfg.ServerURL {
		fallback := cfg.DirectURL
		if baseURL == cfg.DirectURL {
			fallback = cfg.ServerURL
		}
		resp, err = post(fallback)
	}
	if err != nil {
		return 0, fmt.Errorf("system information transport failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return resp.StatusCode, fmt.Errorf("system information returned HTTP %d", resp.StatusCode)
	}
	var ack struct {
		OK bool `json:"ok"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&ack); err != nil || !ack.OK {
		return resp.StatusCode, fmt.Errorf("system information not acknowledged")
	}
	return resp.StatusCode, nil
}

func inventoryDelay(status int, err error, failures int) time.Duration {
	if err == nil {
		return time.Hour
	}
	if status == http.StatusNotFound || status == http.StatusMethodNotAllowed {
		return 6 * time.Hour
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return time.Hour
	}
	if failures < 1 {
		failures = 1
	}
	if failures > 6 {
		return time.Hour
	}
	return time.Minute * time.Duration(1<<uint(failures-1))
}

func runSystemInfoReporter(ctx context.Context, cfg *Config) {
	// Dedicated worker: slow inventory, an older panel or invalid data must never block heartbeats.
	failures := 0
	for ctx.Err() == nil {
		collectedAt := time.Now().UTC()
		collectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		values := collectSystemInfo(collectCtx, localSystemInfo)
		cancel()
		payload := systemInfoPayload{cfg.AgentToken, version, 1, collectedAt, values}
		status, err := reportSystemInfo(ctx, cfg, payload, httpClient)
		if err != nil {
			failures++
			log.Printf("System information report failed (HTTP %d); heartbeat unaffected", status)
		} else {
			failures = 0
		}
		timer := time.NewTimer(inventoryDelay(status, err, failures))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
