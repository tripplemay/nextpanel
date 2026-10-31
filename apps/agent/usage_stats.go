package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protowire"
)

type usageCounter struct {
	Email     string `json:"email"`
	UpBytes   string `json:"upBytes"`
	DownBytes string `json:"downBytes"`
}
type usageSample struct {
	NodeID    string         `json:"nodeId"`
	SampleID  string         `json:"sampleId"`
	SampledAt string         `json:"sampledAt"`
	Uptime    uint64         `json:"uptime"`
	Error     string         `json:"error,omitempty"`
	Users     []usageCounter `json:"users"`
}

var usageCache struct {
	sync.Mutex
	samples []usageSample
}
var usageRunning atomic.Bool
var usageCursor int
var usageName = regexp.MustCompile(`^user>>>(np-legacy|np-usage-[a-z0-9]{1,40})>>>traffic>>>(uplink|downlink)$`)

func latestUsageSamples() []usageSample {
	usageCache.Lock()
	defer usageCache.Unlock()
	return append([]usageSample(nil), usageCache.samples...)
}

// Collection is bounded and off the heartbeat path; failed stats never block proxy work.
func refreshUsageSamples(nodes []xrayNode) {
	if !usageRunning.CompareAndSwap(false, true) {
		return
	}
	selected, next := selectUsageNodes(nodes, usageCursor)
	usageCursor = next
	go func() {
		defer usageRunning.Store(false)
		collectUsageSamples(selected)
	}()
}

func selectUsageNodes(nodes []xrayNode, cursor int) ([]xrayNode, int) {
	var eligible []xrayNode
	for _, node := range nodes {
		if node.Usage {
			eligible = append(eligible, node)
		}
	}
	if len(eligible) <= 20 {
		return eligible, 0
	}
	sort.Slice(eligible, func(i, j int) bool { return eligible[i].NodeID < eligible[j].NodeID })
	selected := make([]xrayNode, 20)
	for i := range selected {
		selected[i] = eligible[(cursor+i)%len(eligible)]
	}
	return selected, (cursor + len(selected)) % len(eligible)
}

func collectUsageSamples(selected []xrayNode) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	results := make([]usageSample, len(selected))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, node := range selected {
		wg.Add(1)
		go func(i int, node xrayNode) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			results[i] = queryUsage(ctx, node)
		}(i, node)
	}
	wg.Wait()
	filtered := make([]usageSample, 0, len(results))
	for _, sample := range results {
		if sample.NodeID != "" {
			filtered = append(filtered, sample)
		}
	}
	usageCache.Lock()
	usageCache.samples = filtered
	usageCache.Unlock()
}

func queryUsage(parent context.Context, node xrayNode) usageSample {
	var nonce [16]byte
	_, _ = rand.Read(nonce[:])
	sample := usageSample{NodeID: node.NodeID, SampleID: hex.EncodeToString(nonce[:]), SampledAt: time.Now().UTC().Format(time.RFC3339Nano), Users: []usageCounter{}}
	fail := func() usageSample { sample.Error = "UNAVAILABLE"; return sample }
	if node.StatsPort < 1 || node.StatsPort > 65535 {
		return fail()
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	conn, err := grpc.DialContext(ctx, fmt.Sprintf("127.0.0.1:%d", node.StatsPort), grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithBlock(), grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(1024*1024)))
	if err != nil {
		return fail()
	}
	defer conn.Close()
	const prefix = "/xray.app.stats.command.StatsService/"
	var sys, response, after []byte
	if conn.Invoke(ctx, prefix+"GetSysStats", []byte{}, &sys, grpc.ForceCodec(rawCodec{})) != nil {
		return fail()
	}
	uptime, err := usageUptime(sys)
	if err != nil {
		return fail()
	}
	if conn.Invoke(ctx, prefix+"QueryStats", encodeQueryStatsRequest("user>>>np-"), &response, grpc.ForceCodec(rawCodec{})) != nil {
		return fail()
	}
	if conn.Invoke(ctx, prefix+"GetSysStats", []byte{}, &after, grpc.ForceCodec(rawCodec{})) != nil {
		return fail()
	}
	endUptime, err := usageUptime(after)
	if err != nil || endUptime < uptime {
		return fail()
	}
	entries, err := decodeQueryStatsResponse(response)
	if err != nil {
		return fail()
	}
	users, err := usageCounters(entries)
	if err != nil {
		sample.Error = "LIMIT"
		return sample
	}
	sample.Users = users
	sample.Uptime = endUptime
	sample.SampledAt = time.Now().UTC().Format(time.RFC3339Nano)
	return sample
}

func usageCounters(entries []statEntry) ([]usageCounter, error) {
	users := map[string]*usageCounter{}
	for _, stat := range entries {
		match := usageName.FindStringSubmatch(stat.name)
		if match == nil {
			continue
		}
		if stat.value < 0 || stat.value > 999999999999999999 {
			return nil, fmt.Errorf("invalid counter")
		}
		user := users[match[1]]
		if user == nil {
			user = &usageCounter{Email: match[1], UpBytes: "0", DownBytes: "0"}
			users[match[1]] = user
		}
		if len(users) > 501 {
			return nil, fmt.Errorf("counter limit")
		}
		if strings.HasSuffix(stat.name, "uplink") {
			user.UpBytes = strconv.FormatInt(stat.value, 10)
		} else {
			user.DownBytes = strconv.FormatInt(stat.value, 10)
		}
	}
	result := make([]usageCounter, 0, len(users))
	for _, user := range users {
		result = append(result, *user)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Email < result[j].Email })
	return result, nil
}

func usageUptime(data []byte) (uint64, error) {
	var uptime uint64
	for len(data) > 0 {
		num, typ, n := protowire.ConsumeTag(data)
		if n < 0 {
			return 0, protowire.ParseError(n)
		}
		data = data[n:]
		if num == 10 && typ == protowire.VarintType {
			value, n := protowire.ConsumeVarint(data)
			if n < 0 {
				return 0, protowire.ParseError(n)
			}
			uptime = value
			data = data[n:]
		} else {
			n := protowire.ConsumeFieldValue(num, typ, data)
			if n < 0 {
				return 0, protowire.ParseError(n)
			}
			data = data[n:]
		}
	}
	return uptime, nil
}
