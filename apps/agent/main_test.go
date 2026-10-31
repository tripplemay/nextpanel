package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
)

func TestHeartbeatArchitectureAndTrustedUpdateChannel(t *testing.T) {
	oldClient := httpClient
	defer func() { httpClient = oldClient }()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload heartbeatPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload.Architecture != runtime.GOARCH {
			t.Errorf("missing architecture: %s", payload.Architecture)
		}
		json.NewEncoder(w).Encode(heartbeatResponse{OK: true, UpdateCommand: &updateCommand{Version: "9.0.0"}})
	})
	plain := httptest.NewServer(handler)
	defer plain.Close()
	httpClient = plain.Client()
	response, err := sendHeartbeat(&Config{ServerURL: plain.URL, AgentToken: "fixture"}, &Metrics{}, nil, nil)
	if err != nil || response.UpdateCommand != nil {
		t.Fatalf("insecure update command accepted: %v", err)
	}

	secure := httptest.NewTLSServer(handler)
	defer secure.Close()
	httpClient = secure.Client()
	response, err = sendHeartbeat(&Config{ServerURL: secure.URL, DirectURL: plain.URL, AgentToken: "fixture"}, &Metrics{}, nil, nil)
	if err != nil || response.UpdateCommand == nil {
		t.Fatalf("did not prefer authenticated HTTPS: %v", err)
	}
	secure.Close()
	response, err = sendHeartbeat(&Config{ServerURL: secure.URL, DirectURL: plain.URL, AgentToken: "fixture"}, &Metrics{}, nil, nil)
	if err != nil || response.UpdateCommand != nil {
		t.Fatalf("telemetry failover failed or accepted plaintext update: %v", err)
	}
}

func TestHeartbeatSurvivesPanelRollbackWithoutUsageExtension(t *testing.T) {
	oldClient := httpClient
	defer func() { httpClient = oldClient; usageCache.Lock(); usageCache.samples = nil; usageCache.Unlock() }()
	for _, status := range []int{400, 413, 401} {
		usageCache.Lock()
		usageCache.samples = []usageSample{{NodeID: "fixture", SampleID: "sample"}}
		usageCache.Unlock()
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			var payload heartbeatPayload
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			if calls == 1 {
				w.WriteHeader(status)
				return
			}
			if len(payload.UsageSamples) != 0 || payload.AgentToken != "fixture" || payload.CPU != 23 {
				t.Error("fallback changed ordinary heartbeat")
			}
			json.NewEncoder(w).Encode(heartbeatResponse{OK: true})
		}))
		httpClient = server.Client()
		_, err := sendHeartbeat(&Config{ServerURL: server.URL, AgentToken: "fixture"}, &Metrics{CPU: 23}, nil, nil)
		server.Close()
		if status == 401 {
			if err == nil || calls != 1 {
				t.Fatal("authentication errors must not trigger fallback")
			}
		} else if err != nil || calls != 2 {
			t.Fatalf("rollback heartbeat failed: %v", err)
		}
	}
}
