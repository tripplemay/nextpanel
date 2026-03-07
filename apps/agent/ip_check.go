package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

type ipCheckResult struct {
	AgentToken   string `json:"agentToken"`
	Netflix      string `json:"netflix,omitempty"`
	NetflixRegion string `json:"netflixRegion,omitempty"`
	Disney       string `json:"disney,omitempty"`
	DisneyRegion string `json:"disneyRegion,omitempty"`
	Youtube      string `json:"youtube,omitempty"`
	YoutubeRegion string `json:"youtubeRegion,omitempty"`
	Hulu         string `json:"hulu,omitempty"`
	Bilibili     string `json:"bilibili,omitempty"`
	Openai       string `json:"openai,omitempty"`
	Claude       string `json:"claude,omitempty"`
	Gemini       string `json:"gemini,omitempty"`
	Success      bool   `json:"success"`
	Error        string `json:"error,omitempty"`
}

func runIpCheck(cfg *Config, serverId string) {
	log.Printf("开始 IP 质量检测 (serverId=%s)", serverId)

	result := ipCheckResult{
		AgentToken: cfg.AgentToken,
		Success:    true,
	}

	// Netflix
	netflixStatus, netflixRegion := checkNetflix()
	result.Netflix = netflixStatus
	result.NetflixRegion = netflixRegion

	// Disney+
	disneyStatus, disneyRegion := checkDisney()
	result.Disney = disneyStatus
	result.DisneyRegion = disneyRegion

	// YouTube Premium
	youtubeStatus, youtubeRegion := checkYoutube()
	result.Youtube = youtubeStatus
	result.YoutubeRegion = youtubeRegion

	// Hulu
	result.Hulu = checkSimple("https://www.hulu.com/", "hulu.com", 10)

	// Bilibili 港澳台
	result.Bilibili = checkBilibili()

	// OpenAI
	result.Openai = checkSimple("https://chat.openai.com/", "openai.com", 10)

	// Claude
	result.Claude = checkSimple("https://claude.ai/", "claude.ai", 10)

	// Gemini
	result.Gemini = checkSimple("https://gemini.google.com/", "gemini.google.com", 10)

	reportIpCheckResult(cfg, serverId, result)
	log.Printf("IP 质量检测完成 (serverId=%s) netflix=%s disney=%s", serverId, result.Netflix, result.Disney)
}

func checkNetflix() (status string, region string) {
	client := &http.Client{Timeout: 12 * time.Second}

	// Check non-original content availability
	resp, err := client.Get("https://www.netflix.com/title/70143836")
	if err != nil {
		return "BLOCKED", ""
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	bodyStr := string(body)

	if resp.StatusCode == 404 || strings.Contains(bodyStr, "not available") {
		// Try self-produced content
		resp2, err2 := client.Get("https://www.netflix.com/title/80018499")
		if err2 != nil || resp2.StatusCode == 404 {
			return "BLOCKED", ""
		}
		defer resp2.Body.Close()
		return "ORIGINALS_ONLY", ""
	}

	if resp.StatusCode == 200 {
		// Extract region from page
		region = extractNetflixRegion(bodyStr, resp)
		return "UNLOCKED", region
	}

	return "BLOCKED", ""
}

func extractNetflixRegion(body string, resp *http.Response) string {
	// Try to get country from response URL or page content
	finalURL := resp.Request.URL.String()
	if strings.Contains(finalURL, "netflix.com/") {
		// Extract country code from URL path like /us/ or /gb/
		parts := strings.Split(finalURL, "/")
		for i, p := range parts {
			if p == "title" && i > 0 {
				candidate := parts[i-1]
				if len(candidate) == 2 {
					return strings.ToUpper(candidate)
				}
			}
		}
	}

	// Search for country code in body
	markers := []string{`"countryCode":"`, `"country_code":"`}
	for _, marker := range markers {
		idx := strings.Index(body, marker)
		if idx != -1 {
			start := idx + len(marker)
			end := strings.Index(body[start:], `"`)
			if end > 0 && end <= 3 {
				return strings.ToUpper(body[start : start+end])
			}
		}
	}
	return ""
}

func checkDisney() (status string, region string) {
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Get("https://www.disneyplus.com/")
	if err != nil {
		return "BLOCKED", ""
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		finalURL := resp.Request.URL.String()
		// Extract region from redirect URL
		for _, part := range strings.Split(finalURL, "/") {
			if len(part) == 2 && part == strings.ToLower(part) {
				return "AVAILABLE", strings.ToUpper(part)
			}
		}
		return "AVAILABLE", ""
	}
	return "BLOCKED", ""
}

func checkYoutube() (status string, region string) {
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Get("https://www.youtube.com/premium")
	if err != nil {
		return "BLOCKED", ""
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 32*1024))
	bodyStr := string(body)

	if resp.StatusCode != 200 {
		return "BLOCKED", ""
	}

	if strings.Contains(bodyStr, "is not available") || strings.Contains(bodyStr, "not available in your country") {
		return "BLOCKED", ""
	}

	// Try to extract GL (geographic location) from page
	idx := strings.Index(bodyStr, `"GL":"`)
	if idx != -1 {
		start := idx + 6
		end := strings.Index(bodyStr[start:], `"`)
		if end > 0 && end <= 3 {
			return "AVAILABLE", bodyStr[start : start+end]
		}
	}
	return "AVAILABLE", ""
}

func checkBilibili() string {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get("https://www.bilibili.com/bangumi/play/ss32982")
	if err != nil {
		return "BLOCKED"
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
	bodyStr := string(body)

	if strings.Contains(bodyStr, "抱歉") || strings.Contains(bodyStr, "地区") || resp.StatusCode != 200 {
		return "BLOCKED"
	}
	return "AVAILABLE"
}

func checkSimple(url string, domain string, timeoutSec int) string {
	client := &http.Client{Timeout: time.Duration(timeoutSec) * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "BLOCKED"
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		return "AVAILABLE"
	}
	return "BLOCKED"
}

func reportIpCheckResult(cfg *Config, serverId string, result ipCheckResult) {
	body, err := json.Marshal(result)
	if err != nil {
		log.Printf("IP 检测结果序列化失败: %v", err)
		return
	}

	url := strings.TrimRight(cfg.ServerURL, "/") + fmt.Sprintf("/api/ip-check/%s/result", serverId)
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("IP 检测结果上报失败: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		log.Printf("IP 检测结果上报返回 %d", resp.StatusCode)
	}
}
