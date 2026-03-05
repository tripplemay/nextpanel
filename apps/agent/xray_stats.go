package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protowire"
)

// xrayNode describes a running xray node as returned by the panel heartbeat response.
type xrayNode struct {
	NodeID    string `json:"nodeId"`
	StatsPort int    `json:"statsPort"`
}

// nodeTrafficStat holds cumulative traffic bytes for a single node.
type nodeTrafficStat struct {
	NodeID   string `json:"nodeId"`
	UpBytes  int64  `json:"upBytes"`
	DownBytes int64 `json:"downBytes"`
}

// rawCodec passes protobuf bytes through without re-encoding, letting us
// manually encode requests and decode responses via protowire.
type rawCodec struct{}

func (rawCodec) Marshal(v interface{}) ([]byte, error) {
	b, ok := v.([]byte)
	if !ok {
		return nil, fmt.Errorf("rawCodec: expected []byte, got %T", v)
	}
	return b, nil
}

func (rawCodec) Unmarshal(data []byte, v interface{}) error {
	ptr, ok := v.(*[]byte)
	if !ok {
		return fmt.Errorf("rawCodec: expected *[]byte, got %T", v)
	}
	*ptr = make([]byte, len(data))
	copy(*ptr, data)
	return nil
}

func (rawCodec) Name() string { return "proto" }

// encodeQueryStatsRequest encodes a QueryStatsRequest{pattern, reset=false}.
func encodeQueryStatsRequest(pattern string) []byte {
	var b []byte
	b = protowire.AppendTag(b, 1, protowire.BytesType)
	b = protowire.AppendString(b, pattern)
	// reset = false → proto3 default, omit
	return b
}

type statEntry struct {
	name  string
	value int64
}

// decodeQueryStatsResponse decodes a QueryStatsResponse{repeated Stat stat = 1}.
func decodeQueryStatsResponse(data []byte) ([]statEntry, error) {
	var entries []statEntry
	for len(data) > 0 {
		num, typ, n := protowire.ConsumeTag(data)
		if n < 0 {
			return nil, protowire.ParseError(n)
		}
		data = data[n:]
		if num == 1 && typ == protowire.BytesType {
			msgBytes, n := protowire.ConsumeBytes(data)
			if n < 0 {
				return nil, protowire.ParseError(n)
			}
			data = data[n:]
			e, err := decodeStatEntry(msgBytes)
			if err == nil {
				entries = append(entries, e)
			}
		} else {
			n := protowire.ConsumeFieldValue(num, typ, data)
			if n < 0 {
				return nil, protowire.ParseError(n)
			}
			data = data[n:]
		}
	}
	return entries, nil
}

// decodeStatEntry decodes a Stat{string name=1; int64 value=2}.
func decodeStatEntry(data []byte) (statEntry, error) {
	var e statEntry
	for len(data) > 0 {
		num, typ, n := protowire.ConsumeTag(data)
		if n < 0 {
			return e, protowire.ParseError(n)
		}
		data = data[n:]
		switch {
		case num == 1 && typ == protowire.BytesType:
			v, n := protowire.ConsumeString(data)
			if n < 0 {
				return e, protowire.ParseError(n)
			}
			e.name = v
			data = data[n:]
		case num == 2 && typ == protowire.VarintType:
			v, n := protowire.ConsumeVarint(data)
			if n < 0 {
				return e, protowire.ParseError(n)
			}
			e.value = int64(v)
			data = data[n:]
		default:
			n := protowire.ConsumeFieldValue(num, typ, data)
			if n < 0 {
				return e, protowire.ParseError(n)
			}
			data = data[n:]
		}
	}
	return e, nil
}

// queryXrayNodeTraffic queries the xray gRPC stats API for a single node's
// cumulative upload and download bytes (since xray process start).
func queryXrayNodeTraffic(statsPort int, nodeID string) (upBytes, downBytes int64, err error) {
	addr := fmt.Sprintf("127.0.0.1:%d", statsPort)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	conn, err := grpc.DialContext( //nolint:staticcheck // grpc.Dial deprecated in v1.63 but still functional
		ctx, addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return 0, 0, fmt.Errorf("connect to xray stats API on %s: %w", addr, err)
	}
	defer conn.Close()

	pattern := fmt.Sprintf("inbound>>>in-%s>>>traffic", nodeID)
	reqBytes := encodeQueryStatsRequest(pattern)
	var respBytes []byte

	err = conn.Invoke(
		ctx,
		"/xray.app.stats.command.StatsService/QueryStats",
		reqBytes, &respBytes,
		grpc.ForceCodec(rawCodec{}),
	)
	if err != nil {
		return 0, 0, fmt.Errorf("QueryStats: %w", err)
	}

	entries, err := decodeQueryStatsResponse(respBytes)
	if err != nil {
		return 0, 0, fmt.Errorf("decode stats response: %w", err)
	}

	for _, e := range entries {
		if strings.HasSuffix(e.name, "uplink") {
			upBytes = e.value
		} else if strings.HasSuffix(e.name, "downlink") {
			downBytes = e.value
		}
	}
	return upBytes, downBytes, nil
}

// collectNodeTraffic queries stats for all provided xray nodes.
// Nodes that fail to respond are silently skipped.
func collectNodeTraffic(nodes []xrayNode) []nodeTrafficStat {
	if len(nodes) == 0 {
		return nil
	}
	result := make([]nodeTrafficStat, 0, len(nodes))
	for _, n := range nodes {
		up, down, err := queryXrayNodeTraffic(n.StatsPort, n.NodeID)
		if err != nil {
			// Node may not be running yet — skip silently
			continue
		}
		result = append(result, nodeTrafficStat{NodeID: n.NodeID, UpBytes: up, DownBytes: down})
	}
	return result
}
