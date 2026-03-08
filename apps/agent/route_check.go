package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// routeTarget defines one of the 9 Chinese ISP test endpoints.
type routeTarget struct {
	ISP  string
	City string
	IP   string
}

// 3 ISPs × 3 cities = 9 fixed test targets (well-known public DNS/IPs)
var routeTargets = []routeTarget{
	{ISP: "联通", City: "北京", IP: "202.106.0.20"},
	{ISP: "联通", City: "上海", IP: "210.22.97.1"},
	{ISP: "联通", City: "广州", IP: "221.5.88.88"},
	{ISP: "电信", City: "北京", IP: "202.96.128.166"},
	{ISP: "电信", City: "上海", IP: "202.96.209.133"},
	{ISP: "电信", City: "广州", IP: "202.96.134.133"},
	{ISP: "移动", City: "北京", IP: "221.130.33.52"},
	{ISP: "移动", City: "上海", IP: "120.196.165.24"},
	{ISP: "移动", City: "广州", IP: "211.136.192.6"},
}

// RouteHop is one hop in a traceroute path.
type RouteHop struct {
	N   int     `json:"n"`
	IP  string  `json:"ip"`
	ASN string  `json:"asn,omitempty"`
	Org string  `json:"org,omitempty"`
	Ms  float64 `json:"ms"` // -1 means timeout/unreachable
}

// OutboundResult is the 回程 measurement result for one target.
type OutboundResult struct {
	ISP    string     `json:"isp"`
	City   string     `json:"city"`
	IP     string     `json:"ip"`
	PingMs float64    `json:"pingMs"` // -1 = unreachable
	TcpMs  float64    `json:"tcpMs"`  // -1 = unreachable
	Loss   int        `json:"loss"`   // packet loss count out of 3
	Hops   []RouteHop `json:"hops,omitempty"`
}

// RouteData is the top-level structure stored in ServerIpCheck.routeData.outbound.
type RouteData struct {
	CheckedAt string           `json:"checkedAt"`
	Outbound  []OutboundResult `json:"outbound"`
}

// runRouteCheck measures 回程 (node → China) to all 9 targets concurrently.
// Total timeout: 90 seconds.
func runRouteCheck() *RouteData {
	data := &RouteData{
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
		Outbound:  make([]OutboundResult, len(routeTargets)),
	}

	hasNexttrace := commandExists("nexttrace")
	hasTraceroute := commandExists("traceroute")

	var wg sync.WaitGroup
	for i, target := range routeTargets {
		wg.Add(1)
		go func(idx int, t routeTarget) {
			defer wg.Done()
			data.Outbound[idx] = measureTarget(t, hasNexttrace, hasTraceroute)
		}(i, target)
	}

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(90 * time.Second):
	}

	return data
}

func measureTarget(t routeTarget, hasNexttrace, hasTraceroute bool) OutboundResult {
	r := OutboundResult{ISP: t.ISP, City: t.City, IP: t.IP}
	r.PingMs, r.Loss = pingHost(t.IP, 3, 5)
	r.TcpMs = tcpConnect(t.IP, 80, 5)
	if hasNexttrace {
		r.Hops = nexttrace(t.IP)
	} else if hasTraceroute {
		r.Hops = traceroute(t.IP)
	}
	return r
}

// commandExists checks whether a command is available in PATH.
func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// tcpConnect measures TCP handshake latency to ip:port.
// Returns -1 on failure.
func tcpConnect(ip string, port int, timeoutSec int) float64 {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), time.Duration(timeoutSec)*time.Second)
	if err != nil {
		return -1
	}
	conn.Close()
	ms := float64(time.Since(start).Microseconds()) / 1000.0
	return math.Round(ms*10) / 10
}

// pingHost runs `ping -c count -W timeout ip` and returns avg ms + packet loss count.
func pingHost(ip string, count int, timeoutSec int) (avgMs float64, loss int) {
	out, err := exec.Command("ping", "-c", strconv.Itoa(count), "-W", strconv.Itoa(timeoutSec), ip).Output()
	if err != nil {
		return -1, count
	}
	body := string(out)

	// "X% packet loss"
	if m := regexp.MustCompile(`(\d+)% packet loss`).FindStringSubmatch(body); len(m) > 1 {
		pct, _ := strconv.Atoi(m[1])
		loss = pct * count / 100
	}
	// "min/avg/max/mdev = X/Y/Z/W ms"
	if m := regexp.MustCompile(`min/avg/max.*?= [\d.]+/([\d.]+)/`).FindStringSubmatch(body); len(m) > 1 {
		avgMs, _ = strconv.ParseFloat(m[1], 64)
	}
	return avgMs, loss
}

// nexttrace runs nexttrace with JSON output and parses hops.
// Falls back to traceroute on parse failure.
func nexttrace(ip string) []RouteHop {
	out, err := exec.Command("nexttrace", "--json", "--max-hops", "20", "-q", "1", ip).Output()
	if err != nil || len(out) == 0 {
		return traceroute(ip)
	}

	// nexttrace --json outputs NDJSON: one JSON object per line
	type ntHop struct {
		Sended   int     `json:"Sended"`
		Recived  int     `json:"Recived"`
		Avg      float64 `json:"Avg"`
		Address  string  `json:"Address"`
		Org      string  `json:"Org"` // "AS4134 China Telecom"
	}
	type ntLine struct {
		Hop ntHop `json:"hop"`
	}

	var hops []RouteHop
	for n, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var parsed ntLine
		if err := json.Unmarshal([]byte(line), &parsed); err != nil {
			continue
		}
		h := parsed.Hop
		hop := RouteHop{N: n + 1, IP: h.Address, Ms: h.Avg}
		if h.Address == "" || h.Address == "*" {
			hop.IP = "*"
			hop.Ms = -1
		}
		if h.Org != "" {
			parts := strings.SplitN(h.Org, " ", 2)
			if len(parts) >= 1 && strings.HasPrefix(parts[0], "AS") {
				hop.ASN = parts[0]
			}
			if len(parts) >= 2 {
				hop.Org = strings.TrimSpace(parts[1])
			}
		}
		hops = append(hops, hop)
	}

	if len(hops) == 0 {
		return traceroute(ip)
	}
	return hops
}

// traceroute runs `traceroute -n -m 20 -w 2 ip` and parses standard output.
func traceroute(ip string) []RouteHop {
	out, err := exec.Command("traceroute", "-n", "-m", "20", "-w", "2", ip).CombinedOutput()
	if err != nil && len(out) == 0 {
		return nil
	}

	// Line format: " 1  1.2.3.4  1.234 ms  1.456 ms  1.789 ms"
	// Timeout:     " 2  * * *"
	hopRe := regexp.MustCompile(`^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+ms`)
	timeoutRe := regexp.MustCompile(`^\s*(\d+)\s+\*`)

	var hops []RouteHop
	for _, line := range strings.Split(string(out), "\n") {
		if m := hopRe.FindStringSubmatch(line); len(m) >= 4 {
			n, _ := strconv.Atoi(m[1])
			ms, _ := strconv.ParseFloat(m[3], 64)
			hops = append(hops, RouteHop{N: n, IP: m[2], Ms: ms})
		} else if m := timeoutRe.FindStringSubmatch(line); len(m) >= 2 {
			n, _ := strconv.Atoi(m[1])
			hops = append(hops, RouteHop{N: n, IP: "*", Ms: -1})
		}
	}
	return hops
}
