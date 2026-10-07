package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func elfFixture(t *testing.T, machine uint16) (string, string) {
	t.Helper()
	data := make([]byte, 64)
	copy(data, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
	binary.LittleEndian.PutUint16(data[16:], 2)
	binary.LittleEndian.PutUint16(data[18:], machine)
	binary.LittleEndian.PutUint32(data[20:], 1)
	binary.LittleEndian.PutUint16(data[52:], 64)
	path := filepath.Join(t.TempDir(), "agent")
	if err := os.WriteFile(path, data, 0700); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	return path, hex.EncodeToString(hash[:])
}

func TestUpdateFileIntegrityAndArchitecture(t *testing.T) {
	for arch, machine := range map[string]uint16{"amd64": 62, "arm64": 183} {
		path, hash := elfFixture(t, machine)
		if err := verifyUpdateFile(path, hash, arch); err != nil {
			t.Fatal(err)
		}
		if err := verifyUpdateFile(path, strings.Repeat("0", 64), arch); err == nil {
			t.Fatal("accepted corrupt digest")
		}
		other := "amd64"
		if arch == "amd64" {
			other = "arm64"
		}
		if err := verifyUpdateFile(path, hash, other); err == nil {
			t.Fatal("accepted wrong architecture")
		}
	}
}

func TestUpdateURLBoundary(t *testing.T) {
	good := "https://github.com/owner/repo/releases/download/v1.7.0/agent-linux-" + runtime.GOARCH
	if err := validateUpdateURL(good); err != nil {
		t.Fatal(err)
	}
	for _, url := range []string{
		strings.Replace(good, "https:", "http:", 1),
		strings.Replace(good, "github.com", "github.com.attacker.test", 1),
		good + "?redirect=bad", good + "#fragment", good + ".exe",
		strings.Replace(good, "github.com", "user:pass@github.com", 1),
	} {
		if err := validateUpdateURL(url); err == nil {
			t.Fatalf("accepted %s", url)
		}
	}
}

func TestReplacementRequiresRollbackSupervisor(t *testing.T) {
	oldRun := runUpdateCommand
	defer func() { runUpdateCommand = oldRun }()
	for _, fail := range []bool{true, false} {
		root := t.TempDir()
		exe := filepath.Join(root, "agent with spaces")
		candidate := filepath.Join(root, "new")
		os.WriteFile(exe, []byte("old"), 0700)
		os.WriteFile(candidate, []byte("new"), 0700)
		runUpdateCommand = func(name string, args ...string) error {
			if name != "systemd-run" || args[len(args)-1] != exe || args[len(args)-2] != "--rollback" || args[len(args)-3] != exe+".previous" {
				t.Fatalf("unsafe supervisor arguments: %s %v", name, args)
			}
			if fail {
				return errors.New("no supervisor")
			}
			return nil
		}
		err := replaceWithRollback(exe, candidate)
		current, _ := os.ReadFile(exe)
		if fail {
			if err == nil || string(current) != "old" {
				t.Fatal("modified executable without rollback")
			}
			if _, err := os.Stat(exe + ".previous"); !os.IsNotExist(err) {
				t.Fatal("stale backup after aborted update")
			}
		} else {
			previous, _ := os.ReadFile(exe + ".previous")
			if err != nil || string(current) != "new" || string(previous) != "old" {
				t.Fatal("replacement lost previous binary")
			}
		}
	}
}

func TestFailedReplacementRetainsRecoverableBackup(t *testing.T) {
	oldRun := runUpdateCommand
	defer func() { runUpdateCommand = oldRun }()
	runUpdateCommand = func(string, ...string) error { return nil }
	exe := filepath.Join(t.TempDir(), "agent")
	os.WriteFile(exe, []byte("old"), 0700)
	if err := replaceWithRollback(exe, exe+".missing"); err == nil {
		t.Fatal("expected failure")
	}
	backup, _ := os.ReadFile(exe + ".previous")
	if string(backup) != "old" {
		t.Fatal("lost recovery binary")
	}
}

func TestRollbackRestoresOnlyItsOwnExecutable(t *testing.T) {
	oldRun := runUpdateCommand
	defer func() { runUpdateCommand = oldRun }()
	called := false
	runUpdateCommand = func(name string, args ...string) error {
		called = true
		if name != "systemctl" || strings.Join(args, " ") != "restart nextpanel-agent" {
			t.Fatal("wrong restart command")
		}
		return nil
	}
	exe := filepath.Join(t.TempDir(), "agent")
	os.WriteFile(exe, []byte("new"), 0700)
	os.WriteFile(exe+".previous", []byte("old"), 0700)
	if err := restorePreviousExecutable(exe+".previous", exe+".other"); err == nil {
		t.Fatal("accepted a foreign rollback path")
	}
	if err := restorePreviousExecutable(exe+".previous", exe); err != nil {
		t.Fatal(err)
	}
	current, _ := os.ReadFile(exe)
	if string(current) != "old" || !called {
		t.Fatal("rollback did not restore and restart")
	}
}

func TestConfirmationDoesNotRequireUnloadedTransientService(t *testing.T) {
	oldRun := runUpdateCommand
	defer func() { runUpdateCommand = oldRun }()
	exe := filepath.Join(t.TempDir(), "agent")
	os.WriteFile(exe+".previous", []byte("previous"), 0700)
	runUpdateCommand = func(name string, args ...string) error {
		if name != "systemctl" || strings.Join(args, " ") != "stop nextpanel-agent-rollback.timer" {
			t.Fatal("confirmation depends on unloaded service")
		}
		return nil
	}
	if err := confirmUpdateAt(exe); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(exe + ".previous"); !os.IsNotExist(err) {
		t.Fatal("confirmed backup blocks the next update")
	}
}
