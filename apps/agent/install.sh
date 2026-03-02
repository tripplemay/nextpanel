#!/bin/bash
# NextPanel Agent 安装脚本
# 用法: bash install.sh <PANEL_URL> <AGENT_TOKEN>

set -e

PANEL_URL="${1:-}"
AGENT_TOKEN="${2:-}"
GITHUB_REPO="tripplemay/nextpanel"

if [ -z "$PANEL_URL" ] || [ -z "$AGENT_TOKEN" ]; then
  echo "用法: bash install.sh <PANEL_URL> <AGENT_TOKEN>"
  exit 1
fi

echo "[1/5] 检测系统架构..."
ARCH=$(uname -m)
case $ARCH in
  x86_64)  BINARY="agent-linux-amd64" ;;
  aarch64) BINARY="agent-linux-arm64" ;;
  *)       echo "不支持的架构: $ARCH"; exit 1 ;;
esac
echo "      架构: $ARCH → $BINARY"

echo "[2/5] 获取最新版本..."
LATEST=$(curl -sf "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
  | grep '"tag_name"' | cut -d'"' -f4)
if [ -z "$LATEST" ]; then
  echo "无法获取最新版本，请检查网络或 GitHub 仓库是否公开"
  exit 1
fi
echo "      版本: $LATEST"

echo "[3/5] 下载 Agent 二进制..."
curl -fsSL "https://github.com/${GITHUB_REPO}/releases/download/${LATEST}/${BINARY}" \
  -o /usr/local/bin/nextpanel-agent
chmod +x /usr/local/bin/nextpanel-agent
echo "      下载完成"

echo "[4/5] 写入配置文件..."
mkdir -p /etc/nextpanel
cat > /etc/nextpanel/agent.json <<EOF
{
  "serverUrl": "${PANEL_URL}",
  "agentToken": "${AGENT_TOKEN}"
}
EOF
echo "      配置写入 /etc/nextpanel/agent.json"

echo "[5/5] 注册并启动 systemd 服务..."
cat > /etc/systemd/system/nextpanel-agent.service <<EOF
[Unit]
Description=NextPanel Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/nextpanel-agent
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nextpanel-agent
systemctl restart nextpanel-agent

echo ""
echo "✓ NextPanel Agent 安装完成"
systemctl status nextpanel-agent --no-pager
