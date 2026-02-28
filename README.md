# NextPanel

一站式多协议代理服务器管理面板。

An all-in-one multi-protocol proxy server management panel with deployment automation, monitoring, and audit logging.

## Quick Links

- **Getting Started**: See [RUNBOOK.md](./docs/RUNBOOK.md) for quick start
- **Contributing**: See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for development setup
- **API Docs**: http://localhost:3001/api/docs (when running)

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js + Ant Design + TanStack Query | 15.1.3 + 5.22.7 + 5.62.16 |
| Backend | NestJS + Prisma | 10.4.15 + 5.22.0 |
| Database | PostgreSQL | 16 |
| Package Manager | pnpm workspace | 9+ |

## Features

### Core Capabilities

- **Server Management** — Register and manage multiple proxy servers
  - SSH connection (key or password auth)
  - Server health monitoring (CPU, RAM, disk, network)
  - Real-time agent heartbeats
  - Tags and metadata

- **Node Configuration** — Configure proxy nodes with multiple protocols
  - Supported protocols: VMess, VLESS, Trojan, Shadowsocks, SOCKS5, HTTP
  - Implementations: XRay, V2Ray, Sing-Box, SS-Libev
  - Transports: TCP, WebSocket, gRPC, QUIC
  - TLS modes: None, TLS, Reality

- **Configuration Templates** — Reusable deployment templates
  - Template variables for configuration customization
  - JSON-based configuration format
  - Version control via ConfigSnapshot

- **Release Management** — Deploy configurations to servers
  - Release strategies: Single, Batch, Canary
  - Audit trail for all deployments
  - Rollback support
  - Real-time status tracking

- **Subscriptions** — Distribute node configurations
  - Create subscription feeds for client applications
  - Token-based access control
  - Include/exclude specific nodes

- **Metrics & Monitoring** — Track server performance
  - CPU, memory, disk, network metrics
  - Historical data aggregation
  - Dashboard overview

- **Audit Logging** — Complete action history
  - Login, logout, deployment actions
  - SSH testing, configuration changes
  - Diff tracking for updates

- **User Management** — Role-based access control
  - Admin — Full access
  - Operator — Deploy and manage
  - Viewer — Read-only access

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 15)                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Pages (Servers, Nodes, Templates, Releases, Metrics) │   │
│  │ Components (Forms, Lists, Details, Charts)           │   │
│  │ State: Zustand (auth) + TanStack Query (server data) │   │
│  │ HTTP Client: Axios with JWT middleware               │   │
│  └──────────────────────────────────────────────────────┘   │
│  Port: 3000                                                  │
└─────────────────────┬──────────────────────────────────────┘
                      │ HTTP/REST API
┌─────────────────────▼──────────────────────────────────────┐
│                Backend (NestJS 10)                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Modules:                                             │   │
│  │ • AuthModule — JWT authentication & authorization    │   │
│  │ • ServersModule — Server CRUD & health              │   │
│  │ • NodesModule — Node configuration & deployment     │   │
│  │ • TemplatesModule — Template management             │   │
│  │ • ReleasesModule — Release orchestration            │   │
│  │ • SubscriptionsModule — Subscription feeds          │   │
│  │ • MetricsModule — Metrics collection & aggregation  │   │
│  │ • AgentModule — Remote agent heartbeat receiver     │   │
│  │ • AuditModule — Action logging                      │   │
│  └──────────────────────────────────────────────────────┘   │
│  Middleware: JWT validation, CORS, logging                  │
│  Port: 3001                                                  │
└─────────────────────┬──────────────────────────────────────┘
                      │ Prisma ORM
┌─────────────────────▼──────────────────────────────────────┐
│            Database (PostgreSQL 16)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Tables:                                              │   │
│  │ • User (with roles)                                  │   │
│  │ • Server (with agent tokens & health metrics)        │   │
│  │ • Node (with encrypted credentials)                  │   │
│  │ • Template (with variable placeholders)              │   │
│  │ • Release + ReleaseStep (deployment tracking)        │   │
│  │ • ConfigSnapshot (version history)                   │   │
│  │ • ServerMetric (time-series metrics)                 │   │
│  │ • Subscription + SubscriptionNode (distributions)    │   │
│  │ • AuditLog (compliance & debugging)                  │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│         Remote Agents (on target servers)                     │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Lightweight agent process                            │    │
│  │ • Polls for pending releases                         │    │
│  │ • Executes deployment commands                       │    │
│  │ • Reports heartbeat (metrics, node status)           │    │
│  │ • Updates Server entity with latest status           │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  API Endpoints:                                              │
│  • GET /api/releases/pending (agent polls)                   │
│  • POST /api/agent/heartbeat (agent reports)                 │
│  • PUT /api/releases/{id}/step/{id} (report step status)     │
└──────────────────────────────────────────────────────────────┘
```

## Data Models

### Key Relationships

```
User (id, username, role)
  ├─→ auditLogs (who did what)
  ├─→ releases (who deployed)
  ├─→ templates (who created)
  └─→ subscriptions (who owns)

Server (id, name, ip, sshAuth)
  ├─→ nodes (what proxies run here)
  ├─→ releaseSteps (deployment history)
  ├─→ metrics (performance data)
  └─→ agentToken (unique identity for agent)

Node (id, protocol, credentials)
  ├─→ snapshots (config versions)
  └─→ subscriptionNodes (included in which feeds)

Template (id, protocol, content)
  └─→ releases (deployed from this template)

Release (id, template, variables, strategy)
  └─→ releaseSteps (execution per server)

Subscription (id, token)
  └─→ subscriptionNodes (which nodes to distribute)

AuditLog (action, resource, diff)
  └─→ Track all changes for compliance
```

## API Overview

<!-- AUTO-GENERATED: Core endpoints from architecture -->

### Authentication

```
POST   /api/auth/login                 # Login with username/password
GET    /api/auth/me                    # Get current user info
```

### Servers

```
GET    /api/servers                    # List all servers (paginated)
POST   /api/servers                    # Create new server
GET    /api/servers/:id                # Get server details
PATCH  /api/servers/:id                # Update server
DELETE /api/servers/:id                # Delete server
POST   /api/servers/:id/test-ssh       # Test SSH connectivity
```

### Nodes

```
GET    /api/nodes                      # List all nodes (paginated)
POST   /api/nodes                      # Create node on server
GET    /api/nodes/:id                  # Get node details
PATCH  /api/nodes/:id                  # Update node
DELETE /api/nodes/:id                  # Delete node
```

### Templates

```
GET    /api/templates                  # List all templates
POST   /api/templates                  # Create new template
GET    /api/templates/:id              # Get template details
PATCH  /api/templates/:id              # Update template
DELETE /api/templates/:id              # Delete template
```

### Releases

```
GET    /api/releases                   # List all releases
POST   /api/releases                   # Create and deploy release
GET    /api/releases/:id               # Get release details
GET    /api/releases/pending           # Agent polls for pending releases
```

### Metrics & Monitoring

```
GET    /api/metrics/overview           # Dashboard stats
GET    /api/metrics/servers/:id        # Server metrics history
```

### Agent Endpoints

```
POST   /api/agent/heartbeat            # Agent sends heartbeat
```

### Subscriptions

```
GET    /api/subscriptions              # List subscriptions
POST   /api/subscriptions              # Create subscription
GET    /api/subscriptions/:token/nodes # Get nodes for subscription
```

### Audit

```
GET    /api/audit-logs                 # List audit logs
```

<!-- END AUTO-GENERATED -->

Full API documentation available at http://localhost:3001/api/docs (Swagger UI)

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Database Setup

```bash
# Start PostgreSQL (with Docker)
docker-compose up -d

# Or use local PostgreSQL instance
```

### 3. Environment Configuration

```bash
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env` and update:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — Run `openssl rand -hex 32`
- `ENCRYPTION_KEY` — Run `openssl rand -hex 32`

### 4. Initialize Database

```bash
cd apps/server
pnpm exec prisma migrate dev --name init
pnpm exec prisma db seed  # Optional: creates admin user
```

### 5. Start Development

```bash
cd /path/to/nextpannel
pnpm dev
```

Access:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001/api
- API Docs: http://localhost:3001/api/docs

## Documentation

- **[RUNBOOK.md](./docs/RUNBOOK.md)** — How to run, troubleshoot, and deploy
- **[CONTRIBUTING.md](./docs/CONTRIBUTING.md)** — Development setup and workflow
- **API Docs** — http://localhost:3001/api/docs (Swagger)
- **Database Schema** — `apps/server/prisma/schema.prisma`
- **Shared Types** — `packages/shared/src/`

## Project Structure

```
nextpannel/
├── apps/
│   ├── server/                 # NestJS backend
│   │   ├── src/
│   │   │   ├── auth/          # JWT authentication
│   │   │   ├── servers/       # Server management
│   │   │   ├── nodes/         # Node deployment
│   │   │   ├── templates/     # Configuration templates
│   │   │   ├── releases/      # Release orchestration
│   │   │   ├── subscriptions/ # Subscription distribution
│   │   │   ├── metrics/       # Monitoring & metrics
│   │   │   ├── agent/         # Agent heartbeat receiver
│   │   │   ├── audit/         # Audit logging
│   │   │   └── main.ts        # Entry point
│   │   ├── prisma/
│   │   │   ├── schema.prisma  # Database schema
│   │   │   └── seed.ts        # Database seeding
│   │   └── package.json
│   ├── web/                    # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/           # App Router pages
│   │   │   ├── components/    # React components
│   │   │   ├── lib/           # Utilities & API client
│   │   │   └── store/         # Zustand stores
│   │   └── package.json
│   └── docker-compose.yml     # Local development
├── packages/
│   └── shared/                # Shared types & enums
│       ├── src/
│       │   ├── enums.ts       # Shared enums
│       │   └── types.ts       # Shared interfaces
│       └── package.json
├── docs/
│   ├── CONTRIBUTING.md        # Development guide
│   └── RUNBOOK.md             # Operations guide
├── pnpm-workspace.yaml
└── README.md
```

## Development Scripts

```bash
# Root level
pnpm dev      # Start all services
pnpm build    # Build all packages
pnpm lint     # Lint all packages

# Backend (cd apps/server)
pnpm dev      # Start with watch
pnpm build    # Build
pnpm lint     # Lint

# Frontend (cd apps/web)
pnpm dev      # Start dev server
pnpm build    # Build for production
pnpm lint     # Lint
```

## Environment Variables

<!-- AUTO-GENERATED: From .env.example -->

Located in `apps/server/.env`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✓ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✓ | — | JWT signing key (64 hex chars) |
| `JWT_EXPIRES_IN` | | `7d` | Token expiration |
| `ENCRYPTION_KEY` | ✓ | — | AES-256 encryption key (64 hex chars) |
| `PORT` | | `3001` | Server port |
| `ALLOWED_ORIGIN` | | — | CORS origin (e.g., http://localhost:3000) |

Generate secure keys:
```bash
openssl rand -hex 32
```

<!-- END AUTO-GENERATED -->

## Security Considerations

- **Credentials Encryption** — SSH credentials and node credentials stored encrypted with AES-GCM
- **JWT Authentication** — All API endpoints require valid JWT (except login & health)
- **CORS Protection** — Frontend origin validated server-side
- **Audit Logging** — All actions logged with actor, resource, and diff
- **Agent Authentication** — Each server has unique `agentToken` for identification
- **Password Hashing** — User passwords hashed with bcrypt

## Common Tasks

### Add a New Server

```bash
# Backend API
curl -X POST http://localhost:3001/api/servers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "prod-1",
    "ip": "1.2.3.4",
    "sshUser": "ubuntu",
    "sshPort": 22,
    "sshAuthType": "key",
    "sshAuth": "-----BEGIN RSA PRIVATE KEY-----\n..."
  }'
```

### Deploy Configuration

```bash
# Create release (renders template with variables)
curl -X POST http://localhost:3001/api/releases \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "<id>",
    "targets": ["<server-id>"],
    "strategy": "single",
    "variables": {
      "port": "443",
      "domain": "example.com"
    }
  }'
```

### View Metrics

Frontend dashboard shows:
- Server health (CPU, RAM, disk, network)
- Node status
- Recent deployments
- Failed operations

## Troubleshooting

See [RUNBOOK.md — Common Problems & Solutions](./docs/RUNBOOK.md#common-problems--solutions)

Common issues:
- **Port in use** — Kill existing process or change port
- **DB connection** — Check `DATABASE_URL` and PostgreSQL running
- **JWT errors** — Regenerate `JWT_SECRET` with `openssl rand -hex 32`
- **Migration fails** — Run `prisma migrate reset --force` (deletes data)

## Development Notes

### Code Organization

- **Backend** — NestJS modules by feature (auth, servers, nodes, etc.)
- **Frontend** — Next.js App Router with collocated components
- **Shared** — TypeScript types and enums in workspace package

### Testing

Currently no automated tests configured. This is a great area for contribution!

### Performance

- Database queries optimized with indexes
- React Query caching on frontend
- Prisma client reused across modules
- Agent heartbeats aggregated for efficiency

## Contributing

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for:
- Development environment setup
- Code style guidelines
- Git workflow
- Testing procedures
- Common development tasks

## License

<!-- Specify your license here -->

## Support

- Check [RUNBOOK.md](./docs/RUNBOOK.md) for troubleshooting
- Review [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for development help
- API documentation: http://localhost:3001/api/docs

---

**Last Updated**: 2026-02-28

Generated documentation. See individual doc files for detailed information.
