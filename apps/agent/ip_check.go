package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

type ipCheckResult struct {
	AgentToken    string     `json:"agentToken"`
	Netflix       string     `json:"netflix,omitempty"`
	NetflixRegion string     `json:"netflixRegion,omitempty"`
	Disney        string     `json:"disney,omitempty"`
	DisneyRegion  string     `json:"disneyRegion,omitempty"`
	Youtube       string     `json:"youtube,omitempty"`
	YoutubeRegion string     `json:"youtubeRegion,omitempty"`
	Hulu          string     `json:"hulu,omitempty"`
	Bilibili      string     `json:"bilibili,omitempty"`
	Openai        string     `json:"openai,omitempty"`
	Claude        string     `json:"claude,omitempty"`
	Gemini        string     `json:"gemini,omitempty"`
	RouteData     *RouteData `json:"routeData,omitempty"`
	Success       bool       `json:"success"`
	Error         string     `json:"error,omitempty"`
}

type curlResult struct {
	StatusCode int
	Body       string
	FinalURL   string
}

// runCurl executes curl with browser-like headers.
// Returns status code, response body (up to 64 KB), and final redirected URL.
func runCurl(timeoutSec int, url string) (curlResult, error) {
	tmpFile, err := os.CreateTemp("", "ipcheck-*.html")
	if err != nil {
		return curlResult{}, fmt.Errorf("create temp file: %w", err)
	}
	tmpName := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpName)

	args := []string{
		"-s",
		"-L",
		"--max-time", strconv.Itoa(timeoutSec),
		"--max-redirs", "5",
		"-A", browserUA,
		"-H", "Accept-Language: en-US,en;q=0.9",
		"-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"-o", tmpName,
		"-w", "%{http_code}\n%{url_effective}",
		url,
	}

	var stdout bytes.Buffer
	cmd := exec.Command("curl", args...)
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return curlResult{}, fmt.Errorf("curl: %w", err)
	}

	lines := strings.SplitN(strings.TrimSpace(stdout.String()), "\n", 2)
	var res curlResult
	if len(lines) >= 1 {
		res.StatusCode, _ = strconv.Atoi(strings.TrimSpace(lines[0]))
	}
	if len(lines) >= 2 {
		res.FinalURL = strings.TrimSpace(lines[1])
	}

	// Read body — limit to 64 KB
	f, err := os.Open(tmpName)
	if err == nil {
		defer f.Close()
		buf := make([]byte, 64*1024)
		n, _ := f.Read(buf)
		res.Body = string(buf[:n])
	}

	return res, nil
}

func runIpCheck(cfg *Config, serverId string) {
	log.Printf("开始 IP 质量检测 (serverId=%s)", serverId)

	if _, err := exec.LookPath("curl"); err != nil {
		log.Printf("curl 未找到，跳过 IP 质量检测")
		reportIpCheckResult(cfg, serverId, ipCheckResult{
			AgentToken: cfg.AgentToken,
			Success:    false,
			Error:      "curl 未安装，无法执行检测",
		})
		return
	}

	result := ipCheckResult{
		AgentToken: cfg.AgentToken,
		Success:    true,
	}

	netflixStatus, netflixRegion := checkNetflix()
	result.Netflix = netflixStatus
	result.NetflixRegion = netflixRegion

	disneyStatus, disneyRegion := checkDisney()
	result.Disney = disneyStatus
	result.DisneyRegion = disneyRegion

	youtubeStatus, youtubeRegion := checkYoutube()
	result.Youtube = youtubeStatus
	result.YoutubeRegion = youtubeRegion

	result.Hulu = checkSimpleURL("https://www.hulu.com/", 10)
	result.Bilibili = checkBilibili()
	result.Openai = checkSimpleURL("https://ios.chat.openai.com/", 10)
	result.Claude = checkSimpleURL("https://claude.ai/", 10)
	result.Gemini = checkSimpleURL("https://gemini.google.com/", 10)

	// Route check (回程): node → 9 Chinese ISP IPs, runs concurrently with total 90s timeout
	log.Printf("开始回程路由检测 (serverId=%s)", serverId)
	result.RouteData = runRouteCheck()
	log.Printf("回程路由检测完成 (serverId=%s)", serverId)

	reportIpCheckResult(cfg, serverId, result)
	log.Printf("IP 质量检测完成 (serverId=%s) netflix=%s openai=%s claude=%s", serverId, result.Netflix, result.Openai, result.Claude)
}

func checkNetflix() (status string, region string) {
	// Check licensed (non-original) content — Breaking Bad
	res, err := runCurl(12, "https://www.netflix.com/title/70143836")
	if err != nil {
		return "BLOCKED", ""
	}

	unavailable := strings.Contains(res.Body, "not available") || strings.Contains(res.Body, "isn't available")
	if res.StatusCode == 200 && !unavailable {
		return "UNLOCKED", extractNetflixRegion(res.FinalURL, res.Body)
	}

	// Check Netflix original — House of Cards
	res2, err := runCurl(12, "https://www.netflix.com/title/80018499")
	if err != nil || res2.StatusCode != 200 {
		return "BLOCKED", ""
	}
	return "ORIGINALS_ONLY", ""
}

func extractNetflixRegion(finalURL, body string) string {
	// Parse from redirect URL: netflix.com/hk/title/... → HK
	parts := strings.Split(finalURL, "/")
	for i, p := range parts {
		if p == "title" && i > 0 {
			candidate := parts[i-1]
			if len(candidate) == 2 && candidate != "en" {
				return strings.ToUpper(candidate)
			}
		}
	}

	// Fallback: parse from body JSON
	for _, marker := range []string{`"countryCode":"`, `"country_code":"`} {
		if idx := strings.Index(body, marker); idx != -1 {
			start := idx + len(marker)
			if end := strings.Index(body[start:], `"`); end > 0 && end <= 3 {
				return strings.ToUpper(body[start : start+end])
			}
		}
	}
	return ""
}

func checkDisney() (status string, region string) {
	res, err := runCurl(12, "https://www.disneyplus.com/")
	if err != nil || res.StatusCode != 200 {
		return "BLOCKED", ""
	}
	for _, part := range strings.Split(res.FinalURL, "/") {
		if len(part) == 2 && part == strings.ToLower(part) {
			return "AVAILABLE", strings.ToUpper(part)
		}
	}
	return "AVAILABLE", ""
}

func checkYoutube() (status string, region string) {
	res, err := runCurl(12, "https://www.youtube.com/premium")
	if err != nil || res.StatusCode != 200 {
		return "BLOCKED", ""
	}
	if strings.Contains(res.Body, "is not available") || strings.Contains(res.Body, "not available in your country") {
		return "BLOCKED", ""
	}
	if idx := strings.Index(res.Body, `"GL":"`); idx != -1 {
		start := idx + 6
		if end := strings.Index(res.Body[start:], `"`); end > 0 && end <= 3 {
			return "AVAILABLE", res.Body[start : start+end]
		}
	}
	return "AVAILABLE", ""
}

func checkBilibili() string {
	res, err := runCurl(10, "https://www.bilibili.com/bangumi/play/ss32982")
	if err != nil || res.StatusCode != 200 {
		return "BLOCKED"
	}
	if strings.Contains(res.Body, "抱歉") || strings.Contains(res.Body, "地区") {
		return "BLOCKED"
	}
	return "AVAILABLE"
}

func checkSimpleURL(url string, timeoutSec int) string {
	res, err := runCurl(timeoutSec, url)
	if err != nil {
		return "BLOCKED"
	}
	if res.StatusCode >= 200 && res.StatusCode < 400 {
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
