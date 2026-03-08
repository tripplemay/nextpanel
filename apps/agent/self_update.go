package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

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
