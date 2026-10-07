package main

import (
	"context"
	"crypto/sha256"
	"debug/elf"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// ensureNexttrace checks if nexttrace is installed; if not, downloads it from GitHub.
// Non-fatal: logs a warning on failure and returns without error.
func ensureNexttrace() {
	if _, err := exec.LookPath("nexttrace"); err == nil {
		return // already installed
	}

	var arch string
	switch runtime.GOARCH {
	case "amd64":
		arch = "amd64"
	case "arm64":
		arch = "arm64"
	default:
		log.Printf("ensureNexttrace: 不支持的架构 %s，跳过", runtime.GOARCH)
		return
	}

	url := fmt.Sprintf("https://github.com/nxtrace/NTrace-core/releases/latest/download/nexttrace_linux_%s", arch)
	dest := "/usr/local/bin/nexttrace"
	log.Printf("nexttrace 未安装，正在下载: %s", url)

	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		log.Printf("ensureNexttrace: 下载失败: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("ensureNexttrace: 下载返回 HTTP %d，跳过", resp.StatusCode)
		return
	}

	f, err := os.OpenFile(dest+".tmp", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		log.Printf("ensureNexttrace: 创建文件失败: %v", err)
		return
	}
	if _, err = io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(dest + ".tmp")
		log.Printf("ensureNexttrace: 写入失败: %v", err)
		return
	}
	f.Close()

	if err = os.Rename(dest+".tmp", dest); err != nil {
		os.Remove(dest + ".tmp")
		log.Printf("ensureNexttrace: 安装失败: %v", err)
		return
	}

	log.Printf("nexttrace 安装完成: %s", dest)
}

const rollbackUnit = "nextpanel-agent-rollback"
const maxUpdateBytes = 64 * 1024 * 1024

// Keep rollback supervision outside the agent's systemd cgroup.
var runUpdateCommand = func(name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w: %s", name, err, output)
	}
	return nil
}

func validateUpdateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		!strings.Contains(u.Path, "/releases/download/") || filepath.Base(u.Path) != "agent-linux-"+runtime.GOARCH {
		return fmt.Errorf("invalid update URL or architecture")
	}
	return nil
}

func verifyUpdateFile(path, digest, arch string) error {
	expected, err := hex.DecodeString(digest)
	if err != nil || len(expected) != sha256.Size {
		return fmt.Errorf("invalid SHA-256 digest")
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	h := sha256.New()
	size, err := io.Copy(h, io.LimitReader(f, maxUpdateBytes+1))
	f.Close()
	if err != nil {
		return err
	}
	if size > maxUpdateBytes || hex.EncodeToString(h.Sum(nil)) != strings.ToLower(digest) {
		return fmt.Errorf("update size or SHA-256 mismatch")
	}
	binary, err := elf.Open(path)
	if err != nil {
		return fmt.Errorf("invalid ELF executable: %w", err)
	}
	defer binary.Close()
	machine := map[string]elf.Machine{"amd64": elf.EM_X86_64, "arm64": elf.EM_AARCH64}[arch]
	if machine == elf.EM_NONE || binary.Class != elf.ELFCLASS64 || binary.Machine != machine ||
		(binary.Type != elf.ET_EXEC && binary.Type != elf.ET_DYN) {
		return fmt.Errorf("update executable architecture mismatch")
	}
	return nil
}

func armRollback(exePath string) error {
	// Execute the preserved, known-good agent; no shell or environment expansion.
	return runUpdateCommand("systemd-run", "--collect", "--unit="+rollbackUnit, "--on-active=180s",
		"--timer-property=AccuracySec=1s", exePath+".previous", "--rollback", exePath)
}

func restorePreviousExecutable(backup, target string) error {
	if !strings.HasSuffix(backup, ".previous") || strings.TrimSuffix(backup, ".previous") != target {
		return fmt.Errorf("invalid rollback target")
	}
	if err := os.Rename(backup, target); err != nil {
		return err
	}
	return runUpdateCommand("systemctl", "restart", "nextpanel-agent")
}

func confirmSelfUpdate() error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	return confirmUpdateAt(exePath)
}

func confirmUpdateAt(exePath string) error {
	_, err := os.Stat(exePath + ".previous")
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	// --collect may unload the never-started service when its timer stops.
	if err = runUpdateCommand("systemctl", "stop", rollbackUnit+".timer"); err != nil {
		return err
	}
	return os.Remove(exePath + ".previous")
}

func replaceWithRollback(exePath, tmpPath string) error {
	backup := exePath + ".previous"
	if err := os.Link(exePath, backup); err != nil {
		return fmt.Errorf("preserve previous executable: %w", err)
	}
	if err := armRollback(exePath); err != nil {
		os.Remove(backup)
		return fmt.Errorf("cannot arm rollback, update cancelled: %w", err)
	}
	if err := os.Rename(tmpPath, exePath); err != nil {
		// Leave supervision armed; the timer will restore the preserved binary.
		return err
	}
	return nil
}

func selfUpdate(downloadURL, digest, targetVersion string) error {
	if err := validateUpdateURL(downloadURL); err != nil {
		return err
	}
	if len(digest) != 64 {
		return fmt.Errorf("missing release digest")
	}
	exePath, err := os.Executable()
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(exePath), ".nextpanel-update-*")
	if err != nil {
		return err
	}
	tmpPath := f.Name()
	defer os.Remove(tmpPath)
	defer f.Close()

	client := &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || req.URL.Scheme != "https" {
			return fmt.Errorf("unsafe download redirect")
		}
		return nil
	}}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download HTTP %d", resp.StatusCode)
	}
	size, err := io.Copy(f, io.LimitReader(resp.Body, maxUpdateBytes+1))
	if err != nil {
		return err
	}
	if size > maxUpdateBytes {
		return fmt.Errorf("update exceeds size limit")
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = verifyUpdateFile(tmpPath, digest, runtime.GOARCH); err != nil {
		return err
	}
	if err = os.Chmod(tmpPath, 0755); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, tmpPath, "--version").Output()
	if err != nil || strings.TrimSpace(string(out)) != targetVersion {
		return fmt.Errorf("candidate version preflight failed")
	}
	if err = replaceWithRollback(exePath, tmpPath); err != nil {
		return err
	}
	log.Printf("Update staged; restarting with rollback watchdog")
	os.Exit(0)
	return nil
}
