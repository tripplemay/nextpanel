package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
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

// selfUpdate downloads the binary at downloadURL, replaces the current executable, then exits.
// PM2 (or the system process manager) is expected to restart the process automatically.
func selfUpdate(downloadURL string) error {
	// Download to a temp file in the same directory as the current binary
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("无法获取当前可执行文件路径: %w", err)
	}

	tmpPath := exePath + ".new"

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("下载失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载返回 HTTP %d", resp.StatusCode)
	}

	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}

	if _, err = io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("写入临时文件失败: %w", err)
	}
	f.Close()

	// Atomically replace the current binary
	if err = os.Rename(tmpPath, exePath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("替换二进制文件失败: %w", err)
	}

	log.Printf("自更新完成，新二进制已就位，正在退出以触发 PM2 重启...")
	os.Exit(0)
	return nil // unreachable
}
