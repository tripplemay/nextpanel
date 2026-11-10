package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
)

func fixtureSources(t *testing.T) systemInfoSources {
	return systemInfoSources{
		cpuInfo: func(context.Context) ([]cpu.InfoStat, error) {
			return []cpu.InfoStat{{ModelName: "Fixture CPU"}, {ModelName: "Fixture CPU"}}, nil
		},
		cpuCount: func(_ context.Context, logical bool) (int, error) {
			if !logical {
				t.Error("physical cores must not be inferred")
			}
			return 2, nil
		},
		memory: func(context.Context) (*mem.VirtualMemoryStat, error) {
			return &mem.VirtualMemoryStat{Total: 4 << 30}, nil
		},
		root: func(_ context.Context, path string) (*disk.UsageStat, error) {
			if path != "/" {
				t.Error("unexpected filesystem scope")
			}
			return &disk.UsageStat{Total: 80 << 30, Fstype: "ext4"}, nil
		},
		platform:       func(context.Context) (string, string, string, error) { return "debian", "debian", "12", nil },
		kernel:         func(context.Context) (string, error) { return "6.1.0", nil },
		virtualization: func(context.Context) (string, string, error) { return "kvm", "guest", nil },
	}
}

func TestSystemInfoCollection(t *testing.T) {
	values := collectSystemInfo(context.Background(), fixtureSources(t))
	if values.CPUModel != "Fixture CPU" || values.CPULogicalCores != 2 || values.MemoryTotalBytes != 4<<30 || values.RootTotalBytes != 80<<30 || values.OSVersion != "12" {
		t.Fatalf("bad inventory: %+v", values)
	}
}

func TestSystemInfoPartialFailure(t *testing.T) {
	sources := fixtureSources(t)
	sources.cpuInfo = func(context.Context) ([]cpu.InfoStat, error) { return nil, errors.New("unavailable") }
	sources.virtualization = func(context.Context) (string, string, error) { return "", "", nil }
	values := collectSystemInfo(context.Background(), sources)
	if values.CPUModel != "" || values.MemoryTotalBytes == 0 || values.RootTotalBytes == 0 || values.VirtualizationSystem != "" {
		t.Fatalf("failure was not isolated or inferred bare metal: %+v", values)
	}
	body, _ := json.Marshal(values)
	if strings.Contains(string(body), "cpuModel") {
		t.Fatal("missing values must be omitted")
	}
}

func TestSystemInfoBoundsAndCancellation(t *testing.T) {
	sources := fixtureSources(t)
	sources.cpuInfo = func(context.Context) ([]cpu.InfoStat, error) {
		return []cpu.InfoStat{{ModelName: strings.Repeat("A", 500)}}, nil
	}
	sources.memory = func(context.Context) (*mem.VirtualMemoryStat, error) {
		return &mem.VirtualMemoryStat{Total: ^uint64(0)}, nil
	}
	sources.kernel = func(ctx context.Context) (string, error) { return "", ctx.Err() }
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	values := collectSystemInfo(ctx, sources)
	if len(values.CPUModel) != 256 || values.MemoryTotalBytes != 0 || values.KernelVersion != "" {
		t.Fatalf("invalid limits: %+v", values)
	}
}

func TestSystemInfoTransportCompatibility(t *testing.T) {
	for _, status := range []int{200, 201, 400, 401, 404, 405, 413, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/api/agent/system-info" {
					t.Error("inventory changed heartbeat route")
				}
				var payload systemInfoPayload
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.AgentToken != "fixture" {
					t.Error("invalid payload")
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer server.Close()
			payload := systemInfoPayload{AgentToken: "fixture", SchemaVersion: 1, CollectedAt: time.Now()}
			code, err := reportSystemInfo(context.Background(), &Config{ServerURL: server.URL}, payload, server.Client())
			if code != status || calls != 1 || (err == nil) != (status == 200 || status == 201) {
				t.Fatalf("unexpected result: %d %v %d", code, err, calls)
			}
			if status == 404 && inventoryDelay(code, err, 1) != 6*time.Hour {
				t.Fatal("old panel must back off")
			}
		})
	}
}

func TestSystemInfoAcknowledgement(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"ok":false}`)) }))
	defer server.Close()
	_, err := reportSystemInfo(context.Background(), &Config{ServerURL: server.URL}, systemInfoPayload{}, server.Client())
	if err == nil {
		t.Fatal("false acknowledgement accepted")
	}
	if inventoryDelay(500, errors.New("fixture"), 8) != time.Hour {
		t.Fatal("backoff must be capped")
	}
}

func TestInventoryFailureDoesNotBreakHeartbeat(t *testing.T) {
	oldClient := httpClient
	defer func() { httpClient = oldClient }()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agent/system-info" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.URL.Path != "/api/agent/heartbeat" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, exists := body["values"]; exists {
			t.Error("inventory leaked into legacy heartbeat")
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	httpClient = server.Client()
	cfg := &Config{ServerURL: server.URL, AgentToken: "fixture"}
	_, err := reportSystemInfo(context.Background(), cfg, systemInfoPayload{}, httpClient)
	if err == nil {
		t.Fatal("old panel should reject inventory")
	}
	if _, err := sendHeartbeat(cfg, &Metrics{}, nil, nil); err != nil {
		t.Fatalf("legacy heartbeat failed after inventory rejection: %v", err)
	}
}

func TestInventoryPrefersHTTPSAndDoesNotRetryAuthentication(t *testing.T) {
	directCalls := 0
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { directCalls++ }))
	defer direct.Close()
	secure := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer secure.Close()
	status, err := reportSystemInfo(context.Background(), &Config{ServerURL: secure.URL, DirectURL: direct.URL}, systemInfoPayload{}, secure.Client())
	if status != http.StatusUnauthorized || err == nil || directCalls != 0 {
		t.Fatalf("authentication was downgraded or retried: %d %v direct=%d", status, err, directCalls)
	}
}
