package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNextTrace175Output(t *testing.T) {
	dir := t.TempDir()
	// Captured from the official 1.7.5 binary using a loopback-only, no-GeoIP trace.
	output := `{"Hops":[[{"Success":true,"Address":{"IP":"127.0.0.1","Zone":""},"Hostname":"","TTL":1,"RTT":251709,"Error":null,"Geo":{"asnumber":"","isp":"","owner":"","whois":"RFC1122"}}]],"StopReason":{"hop":1,"reason":"destination_reached","responses":["ICMP Echo Reply from 127.0.0.1"]},"TraceMapUrl":""}`
	if err := os.WriteFile(filepath.Join(dir, "nexttrace"), []byte("#!/bin/sh\nprintf '%s\\n' '"+output+"'\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	hops := nexttrace("127.0.0.1")
	if len(hops) != 1 || hops[0].N != 1 || hops[0].IP != "127.0.0.1" || hops[0].Ms != 0.3 {
		t.Fatalf("NextTrace 1.7.5 output not parsed: %+v", hops)
	}
}
