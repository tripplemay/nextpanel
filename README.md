# NextPanel

Self-hosted proxy node management panel with one-click deployment, multi-protocol support, and subscription generation.

## Features

- **Server Management** — SSH-based server management with real-time metrics (CPU, memory, disk, network)
- **Node Deployment** — One-click deploy Xray / Sing-box nodes with protocol presets (VMESS, VLESS, Trojan, Shadowsocks, Hysteria2)
- **External Node Import** — Import existing nodes via URI / Base64 / subscription URL for unified management
- **Subscription Management** — Generate V2Ray Base64, Clash YAML, Sing-box JSON subscriptions with sharing support
- **IP and Route Diagnostics** — Streaming/AI service detection (Netflix, Disney+, YouTube, OpenAI, Claude), GFW check, inbound/outbound route analysis
- **Agent System** — Lightweight Go agent for server metrics, streaming checks, route testing, and self-update
- **Multi-Tenant RBAC** — Three roles (ADMIN > OPERATOR > VIEWER) with resource isolation and subscription sharing
- **Audit Logging** — Full operation audit trail with correlation to SSH deployment logs

## Quick Install

**Requirements:** Ubuntu 22.04/24.04 or Debian 12, root access, 1GB+ RAM

```bash
bash <(curl -sL https://raw.githubusercontent.com/tripplemay/nextpanel/main/scripts/install.sh)
```

The installer will guide you through:
1. Access mode selection (domain with auto HTTPS, or IP-only HTTP)
2. Admin account setup
3. Automatic installation of all dependencies (Node.js, PostgreSQL, Nginx, PM2)

Installation takes approximately 5-10 minutes depending on server specs.

## Management

After installation, use the `nextpanel` CLI:

```bash
nextpanel status              # Service status and health check
nextpanel update              # Update to latest version
nextpanel backup              # Backup database (auto-rotates, keeps 5)
nextpanel restore <file>      # Restore from backup
nextpanel domain set <domain> # Bind domain with auto SSL (Lets Encrypt)
nextpanel logs [server|web]   # View service logs
nextpanel uninstall           # Remove NextPanel
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | NestJS 10 (TypeScript) |
| Frontend | Next.js 15 App Router (React 19, Ant Design 5) |
| Database | PostgreSQL 16 + Prisma ORM |
| Agent | Go (systemd service) |
| Process Manager | PM2 |
| Reverse Proxy | Nginx + Certbot |

## Architecture

```
Browser  -->  Nginx (80/443)
                |
                +-- /api/*  -->  NestJS Backend (3001)  -->  PostgreSQL
                |
                +-- /*      -->  Next.js Frontend (3400)

Remote Servers  -->  Agent (heartbeat + metrics)  -->  Backend API
```

## Supported Protocols

| Protocol | Implementation | Transport | TLS |
|----------|---------------|-----------|-----|
| VMESS | Xray | TCP, WS, gRPC | None, TLS |
| VLESS | Xray | TCP, WS, gRPC | None, TLS, REALITY |
| Trojan | Xray | TCP, WS | TLS |
| Shadowsocks | Xray / sing-box | TCP | None |
| Hysteria2 | sing-box | QUIC | TLS (self-signed) |

## Project Structure

```
nextpanel/
  apps/
    server/          # NestJS backend
    web/             # Next.js frontend
    agent/           # Go agent
  packages/
    shared/          # Shared TypeScript types
  scripts/
    install.sh       # One-click install script
    nextpanel        # CLI management tool
    nginx/           # Nginx config templates
```

## License

MIT
