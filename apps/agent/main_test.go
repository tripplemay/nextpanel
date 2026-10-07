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
