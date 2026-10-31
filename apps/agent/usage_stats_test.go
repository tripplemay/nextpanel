package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protowire"
)

func TestUsageSamplingRotatesBeyondBatchLimit(t *testing.T) {
	nodes := []xrayNode{{NodeID: "disabled"}}
	for i := 0; i < 45; i++ {
		nodes = append(nodes, xrayNode{NodeID: fmt.Sprintf("n%02d", i), Usage: true})
	}
	seen := map[string]bool{}
	cursor := 0
	for i := 0; i < 3; i++ {
		var selected []xrayNode
		selected, cursor = selectUsageNodes(nodes, cursor)
		if len(selected) != 20 {
			t.Fatal("batch must be bounded")
		}
		for _, node := range selected {
			seen[node.NodeID] = true
		}
	}
	if len(seen) != 45 || seen["disabled"] {
		t.Fatal("eligible nodes were starved")
	}
}

func TestUsageNativeStats(t *testing.T) {
	port, err := strconv.Atoi(os.Getenv("USAGE_FIXTURE_STATS_PORT"))
	if err != nil {
		t.Skip("requires the loopback usage-native.test.mjs fixture")
	}
	sample := queryUsage(context.Background(), xrayNode{NodeID: "fixture", StatsPort: port, Usage: true})
	if sample.Error != "" {
		t.Fatalf("native stats: %s", sample.Error)
	}
	found := map[string]bool{}
	for _, user := range sample.Users {
		if user.DownBytes != "0" {
			found[user.Email] = true
		}
	}
	if !found["np-usage-one"] || !found["np-legacy"] || found["np-usage-two"] {
		t.Fatal("native traffic attribution failed")
	}
}

func TestUsageFiltersSensitiveAndUnknownStats(t *testing.T) {
	users, err := usageCounters([]statEntry{
		{name: "user>>>np-usage-fixture>>>traffic>>>uplink", value: 1024},
		{name: "user>>>np-usage-fixture>>>traffic>>>downlink", value: 2048},
		{name: "user>>>private@example.com>>>traffic>>>uplink", value: 999},
		{name: "destination>>>private.example", value: 999},
		{name: "user>>>np-legacy>>>traffic>>>downlink", value: 64},
	})
	if err != nil || len(users) != 2 {
		t.Fatalf("unexpected counters: %v", err)
	}
	encoded, _ := json.Marshal(users)
	if strings.Contains(string(encoded), "private") {
		t.Fatal("private metadata leaked")
	}
	if users[1].UpBytes != "1024" || users[1].DownBytes != "2048" {
		t.Fatal("counter attribution failed")
	}
}

func TestUsageRejectsNegativeCountersAndMalformedUptime(t *testing.T) {
	if _, err := usageCounters([]statEntry{{name: "user>>>np-legacy>>>traffic>>>uplink", value: -1}}); err == nil {
		t.Fatal("negative counter accepted")
	}
	if _, err := usageUptime([]byte{255}); err == nil {
		t.Fatal("malformed protobuf accepted")
	}
	data := protowire.AppendTag(nil, 10, protowire.VarintType)
	data = protowire.AppendVarint(data, 123)
	if value, err := usageUptime(data); err != nil || value != 123 {
		t.Fatalf("uptime: %v %v", value, err)
	}
}
