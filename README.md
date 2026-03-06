<div align="center">

<h1>NextPanel</h1>

<p>帮助你在自己的服务器上建立安全的网络通道，完全由你掌控</p>
<p><em>Self-hosted proxy infrastructure you deploy, own, and control</em></p>

[![License](https://img.shields.io/github/license/tripplemay/nextpanel)](LICENSE)
[![Stars](https://img.shields.io/github/stars/tripplemay/nextpanel)](https://github.com/tripplemay/nextpanel/stargazers)
[![Release](https://img.shields.io/github/v/release/tripplemay/nextpanel)](https://github.com/tripplemay/nextpanel/releases)

[中文](#中文) · [English](#english)

</div>

---

## 中文

### 功能特性

| 功能 | 说明 |
|------|------|
| **多协议节点管理** | 支持 VLESS、VMess、Trojan、Shadowsocks、Hysteria2、SOCKS5、HTTP |
| **一键部署** | 通过 SSH 自动部署节点服务，实时查看终端日志 |
| **服务器监控** | CPU、内存、磁盘、网络实时监控，历史图表 |
| **流量统计** | 统计每个节点自上次部署以来的累计上传/下载流量 |
| **订阅导出** | 一键生成 V2Ray / Clash / Sing-Box 格式订阅链接 |
| **Cloudflare 集成** | 自动创建 DNS 记录，支持 VLESS+WS+TLS 节点 |
| **连通性测试** | 端到端测试节点可达性与延迟，支持批量测试 |
| **轻量 Agent** | 安装到服务器后自动上报状态，无需手动维护 |
| **审计日志** | 所有操作均记录，可追溯部署历史 |
| **多用户权限** | Admin / Operator / Viewer 三级权限控制 |
| **账户安全** | 支持在面板内修改密码，无需命令行操作 |

### 界面预览

> 截图持续更新中，欢迎 Star 关注 ✨

| 节点管理 | 服务器监控 |
|---------|-----------|
| ![节点列表](docs/screenshots/nodes.png) | ![服务器监控](docs/screenshots/monitor.png) |

| 部署日志 | 订阅管理 |
|---------|---------|
| ![部署日志](docs/screenshots/deploy.png) | ![订阅](docs/screenshots/subscriptions.png) |

### 部署教程

NextPanel 通过 GitHub Actions 自动部署到你的 VPS，整个过程只需配置一次。

#### 准备工作

- 一台 VPS（推荐 Ubuntu 22.04，内存 ≥ 1GB）
- 一个域名，并将 A 记录指向你的 VPS IP
- 一个 GitHub 账号

#### 步骤一：Fork 仓库

点击右上角 **Fork** 按钮，将本仓库 Fork 到你自己的 GitHub 账号下。

#### 步骤二：配置域名变量

进入你 Fork 后的仓库 → **Settings → Secrets and variables → Actions → Variables**，添加以下 Variable：

| Variable 名称 | 说明 |
|--------------|------|
| `DOMAIN` | 你的面板域名（例如 `panel.example.com`） |

#### 步骤三：配置 GitHub Secrets

进入你 Fork 后的仓库 → **Settings → Secrets and variables → Actions**，添加以下 Secret：

| Secret 名称 | 说明 |
|------------|------|
| `SSH_HOST` | VPS 的 IP 地址 |
| `SSH_USER` | SSH 用户名（通常为 `root`） |
| `SSH_PORT` | SSH 端口（通常为 `22`） |
| `SSH_PASSWORD` | SSH 密码 |
| `CERTBOT_EMAIL` | 用于申请 SSL 证书的邮箱地址 |

#### 步骤四：触发部署

将代码推送到 `main` 分支即可自动触发部署：

```bash
git commit --allow-empty -m "trigger deploy"
git push origin main
```

GitHub Actions 将自动完成：安装环境 → 构建项目 → 迁移数据库 → 启动服务。

首次部署约需 5～10 分钟，完成后访问 `https://你的域名` 即可使用。

#### 步骤五：初始化管理员账号

部署完成后，SSH 登录 VPS 执行：

```bash
cd /opt/apps/nextpanel/apps/server
pnpm exec prisma db seed
```

默认账号：`admin` / `admin123`（首次登录后请前往「系统设置 → 账户安全」立即修改密码）

#### 安装 Agent（可选）

面板部署完成后，若需要监控服务器实时状态，在目标服务器上执行：

```bash
# 替换为你的面板地址和 Agent Token（在面板「服务器」页面查看）
curl -fsSL https://github.com/tripplemay/nextpanel-releases/releases/latest/download/agent-linux-amd64 \
  -o /usr/local/bin/nextpanel-agent && chmod +x /usr/local/bin/nextpanel-agent

# 创建配置文件
mkdir -p /etc/nextpanel
cat > /etc/nextpanel/agent.json <<EOF
{
  "serverUrl": "https://你的域名",
  "agentToken": "在面板页面复制的 Token"
}
EOF

# 启动 Agent
nextpanel-agent
```

### 常见问题

<details>
<summary><b>支持哪些代理协议和客户端？</b></summary>

支持协议：VLESS、VMess、Trojan、Shadowsocks、Hysteria2、SOCKS5、HTTP

支持的代理内核：Xray、V2Ray、Sing-Box、shadowsocks-libev

导出的订阅格式支持 V2Ray、Clash、Sing-Box，可直接导入主流客户端。

</details>

<details>
<summary><b>部署时是否必须有域名？</b></summary>

推荐使用域名，这样面板可以通过 HTTPS 访问，且支持 Cloudflare 集成。

若暂时没有域名，可以用 IP 直接访问（HTTP），但 SSL 证书申请会跳过。

</details>

<details>
<summary><b>面板如何更新？</b></summary>

将你的 Fork 与上游同步后，推送到 main 分支即可自动触发更新部署：

```bash
git fetch upstream
git merge upstream/main
git push origin main
```

数据库迁移会自动执行，无需手动操作。

</details>

<details>
<summary><b>流量统计是实时的吗？</b></summary>

流量数据每 10 秒更新一次（Agent 心跳周期）。统计的是节点自上次部署以来的累计流量，重新部署后清零。

目前仅支持 Xray / V2Ray 节点，Hysteria2（Sing-Box）节点暂不统计，显示为 `-`。

</details>

<details>
<summary><b>忘记管理员密码怎么办？</b></summary>

如果你仍可以登录面板，前往「系统设置 → 账户安全」直接修改密码即可。

如果已无法登录，SSH 登录 VPS，通过 `prisma studio` 可视化修改密码哈希，或执行：

```bash
cd /opt/apps/nextpanel/apps/server
pnpm exec prisma db execute --stdin <<EOF
UPDATE "User" SET "passwordHash" = '$2b$10$替换为新的bcrypt哈希' WHERE username = 'admin';
EOF
```

</details>

---

## English

### Features

| Feature | Description |
|---------|-------------|
| **Multi-protocol Nodes** | VLESS, VMess, Trojan, Shadowsocks, Hysteria2, SOCKS5, HTTP |
| **One-click Deploy** | SSH-based auto-deployment with real-time terminal logs |
| **Server Monitoring** | Real-time CPU, memory, disk, network metrics with history charts |
| **Traffic Statistics** | Cumulative upload/download per node since last deploy |
| **Subscription Export** | Generate V2Ray / Clash / Sing-Box subscription links instantly |
| **Cloudflare Integration** | Auto DNS record creation for VLESS+WS+TLS nodes |
| **Connectivity Test** | End-to-end latency testing with batch support |
| **Lightweight Agent** | Install once, auto-reports server status continuously |
| **Audit Logs** | Full operation history with deployment traceability |
| **Role-based Access** | Admin / Operator / Viewer permission levels |
| **Account Security** | Change password directly in the panel without command-line access |

### Screenshots

> Screenshots are updated continuously. Star the repo to stay updated ✨

| Node Management | Server Monitoring |
|----------------|------------------|
| ![Nodes](docs/screenshots/nodes.png) | ![Monitor](docs/screenshots/monitor.png) |

| Deploy Logs | Subscriptions |
|------------|---------------|
| ![Deploy](docs/screenshots/deploy.png) | ![Subscriptions](docs/screenshots/subscriptions.png) |

### Deployment Guide

NextPanel auto-deploys to your VPS via GitHub Actions. One-time setup, automated ever after.

#### Prerequisites

- A VPS (Ubuntu 22.04 recommended, ≥ 1GB RAM)
- A domain name with an A record pointing to your VPS IP
- A GitHub account

#### Step 1: Fork this repository

Click the **Fork** button in the top right corner.

#### Step 2: Set your domain variable

Go to your forked repo → **Settings → Secrets and variables → Actions → Variables**, and add:

| Variable | Description |
|----------|-------------|
| `DOMAIN` | Your panel domain (e.g. `panel.example.com`) |

#### Step 3: Configure GitHub Secrets

Go to your forked repo → **Settings → Secrets and variables → Actions**, and add:

| Secret | Description |
|--------|-------------|
| `SSH_HOST` | Your VPS IP address |
| `SSH_USER` | SSH username (usually `root`) |
| `SSH_PORT` | SSH port (usually `22`) |
| `SSH_PASSWORD` | SSH password |
| `CERTBOT_EMAIL` | Email for SSL certificate registration |

#### Step 4: Trigger deployment

Push to `main` to start auto-deployment:

```bash
git commit --allow-empty -m "trigger deploy"
git push origin main
```

GitHub Actions will handle everything: install dependencies → build → migrate database → start services.

First deployment takes ~5–10 minutes. Once done, visit `https://your.domain.com`.

#### Step 5: Create admin account

SSH into your VPS and run:

```bash
cd /opt/apps/nextpanel/apps/server
pnpm exec prisma db seed
```

Default credentials: `admin` / `admin123` — **after first login, go to Settings → Account Security to change your password immediately**.

#### Install Agent (optional)

To monitor server metrics in real time, run this on each target server:

```bash
curl -fsSL https://github.com/tripplemay/nextpanel-releases/releases/latest/download/agent-linux-amd64 \
  -o /usr/local/bin/nextpanel-agent && chmod +x /usr/local/bin/nextpanel-agent

mkdir -p /etc/nextpanel
cat > /etc/nextpanel/agent.json <<EOF
{
  "serverUrl": "https://your.domain.com",
  "agentToken": "copy from panel server page"
}
EOF

nextpanel-agent
```

### FAQ

<details>
<summary><b>Which proxy protocols and clients are supported?</b></summary>

Protocols: VLESS, VMess, Trojan, Shadowsocks, Hysteria2, SOCKS5, HTTP

Proxy cores: Xray, V2Ray, Sing-Box, shadowsocks-libev

Subscription formats: V2Ray, Clash, Sing-Box — importable into all major clients.

</details>

<details>
<summary><b>Is a domain name required?</b></summary>

A domain is recommended for HTTPS access and Cloudflare integration.

Without a domain, you can access the panel via IP over HTTP, but SSL certificate issuance will be skipped.

</details>

<details>
<summary><b>How do I update the panel?</b></summary>

Sync your fork with upstream, then push to trigger auto-deployment:

```bash
git fetch upstream
git merge upstream/main
git push origin main
```

Database migrations run automatically — no manual steps needed.

</details>

<details>
<summary><b>Is traffic statistics real-time?</b></summary>

Traffic data updates every 10 seconds (agent heartbeat interval). Statistics are cumulative since the last node deployment and reset when the node is redeployed.

Currently supported for Xray / V2Ray nodes only. Hysteria2 (Sing-Box) nodes show `-`.

</details>

<details>
<summary><b>I forgot my admin password. How do I reset it?</b></summary>

If you can still log in, go to **Settings → Account Security** to change your password directly in the panel.

If you are locked out, SSH into your VPS and use `prisma studio` to update the password hash, or run a SQL update via `prisma db execute`.

</details>

---

## License

[MIT](LICENSE)
