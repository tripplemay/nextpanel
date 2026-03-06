# NextPanel Runbook

Last Updated: 2026-03-06

Quick reference guide for running, deploying, and troubleshooting NextPanel.

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- PostgreSQL >= 16 (or Docker)

### 30-Second Setup

```bash
cd /path/to/nextpanel

# Install dependencies
pnpm install

# Setup backend environment (copy and fill in values)
cp apps/server/.env.example apps/server/.env

# Initialize database (requires SSH tunnel — see Database section)
cd apps/server
pnpm exec prisma migrate dev --name init
pnpm exec prisma db seed

# Start everything (auto-opens SSH tunnel to DB if needed)
cd ../..
pnpm dev
```

Then open:
- Frontend: http://localhost:3400
- Backend API: http://localhost:3001/api
- API Docs: http://localhost:3001/api/docs

## Running the Project

### Start Development Mode

```bash
# From project root
pnpm dev
```

This runs all services in parallel:
- `apps/web` — Next.js on port 3400
- `apps/server` — NestJS on port 3001

> The root `pnpm dev` script also checks for an SSH tunnel to the DB (port 5433) and opens it if needed.

### Start Individual Services

```bash
# Backend only
cd apps/server
pnpm dev

# Frontend only
cd apps/web
pnpm dev
```

### Production Build & Start

```bash
# Build all packages
pnpm build

# Start backend (requires PORT=3001 in .env)
cd apps/server
pnpm start

# In separate terminal, start frontend
cd apps/web
pnpm start
```

## Database Management

### Initial Setup

```bash
cd apps/server

# Run migrations and seed (one command)
pnpm exec prisma migrate dev --name init

# Or separately:
# Run migrations
pnpm exec prisma migrate deploy

# Seed initial data (creates admin user)
pnpm exec prisma db seed
```

### View Database

```bash
cd apps/server

# Open Prisma Studio (visual database browser at http://localhost:5555)
pnpm exec prisma studio
```

### Create New Migration

```bash
cd apps/server

# After modifying schema.prisma, run:
pnpm exec prisma migrate dev --name describe_your_change
```

### Reset Database

```bash
cd apps/server

# WARNING: Deletes all data and recreates schema
pnpm exec prisma migrate reset --force
```

### Seed Database

```bash
cd apps/server

# Run seed script (creates admin user, etc.)
pnpm exec prisma db seed
```

## Environment Variables

<!-- AUTO-GENERATED: From apps/server/.env -->

### Backend (.env file location: `apps/server/.env`)

| Variable | Required | Default | Description | Example |
|----------|----------|---------|-------------|---------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string | `postgresql://user:pass@localhost:5433/nextpanel_dev` |
| `JWT_SECRET` | Yes | — | Secret key for signing JWTs (64 hex chars) | `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | No | `7d` | JWT token expiration duration | `7d`, `24h`, `30d` |
| `ENCRYPTION_KEY` | Yes | — | AES-256-GCM encryption key (64 hex chars) | `openssl rand -hex 32` |
| `PORT` | No | `3001` | API server port | `3001` |
| `ALLOWED_ORIGIN` | Yes | — | CORS origin for frontend | `http://localhost:3400` |
| `PANEL_URL` | Yes | — | Public URL of the panel (used by Agent install script) | `https://panel.example.com` |
| `GITHUB_REPO` | Yes | — | GitHub repo for Agent binary releases | `your-username/nextpanel-releases` |

### Generate Secure Keys

```bash
# Generate JWT_SECRET and ENCRYPTION_KEY (64 hex characters each)
openssl rand -hex 32

# Example output:
# 410e9aa17d5da421837d934a829c75eb055187e4b367af6f49339e14a9d987e2
```

<!-- END AUTO-GENERATED -->

## API Endpoints

### Health & Info

```bash
# Health check
curl http://localhost:3001/api/health

# API docs (Swagger UI)
open http://localhost:3001/api/docs
```

### Authentication

```bash
# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}'

# Returns:
# {
#   "accessToken": "eyJ...",
#   "user": { "id": "...", "username": "admin", "role": "admin" }
# }
```

### Servers

```bash
# List servers
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/servers

# Get server details
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/servers/<id>

# Create server
curl -X POST http://localhost:3001/api/servers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "prod-server-1",
    "region": "us-west",
    "provider": "aws",
    "ip": "203.0.113.1",
    "sshPort": 22,
    "sshUser": "ubuntu",
    "sshAuthType": "key",
    "sshAuth": "-----BEGIN RSA PRIVATE KEY-----\n..."
  }'
```

## Monitoring & Debugging

### Backend Logs

The backend logs to stdout when running `pnpm dev`. Watch for:
- Connection errors → Check DATABASE_URL
- Migration errors → Run `prisma migrate reset`
- JWT errors → Check JWT_SECRET configuration

### Frontend Logs

Browser console (Press F12) shows:
- API errors → Check backend is running
- State errors → Check Zustand store in DevTools
- Next.js build warnings

### Database Status

```bash
cd apps/server

# Check database connection
psql $DATABASE_URL -c "SELECT NOW();"

# View tables
psql $DATABASE_URL -c "\dt"

# Check migrations
pnpm exec prisma migrate status
```

## Common Problems & Solutions

### Port 3400 or 3001 Already in Use

```bash
# Find process using port
lsof -i :3400
lsof -i :3001

# Kill process
kill -9 <PID>

# Or use different port
PORT=3002 pnpm dev
```

### Database Connection Failed

```bash
# Check PostgreSQL is running
psql -U postgres -c "SELECT version();"

# If using Docker:
docker-compose up -d

# Verify DATABASE_URL in .env is correct format:
# postgresql://user:password@host:port/database
```

### Prisma Migrate Fails

```bash
# Option 1: Reset (WARNING: deletes data)
cd apps/server
pnpm exec prisma migrate reset --force

# Option 2: Manually fix conflicts in migration file
# Edit <migration-name>/migration.sql
pnpm exec prisma migrate deploy
```

### Node Modules Corrupted

```bash
# Clean reinstall
rm -rf node_modules pnpm-lock.yaml
pnpm install

# Or if specific package is broken:
pnpm remove <package>
pnpm add <package>
```

### JWT Token Validation Errors

```bash
# Check JWT_SECRET in .env matches deployment
# If invalid, regenerate:
openssl rand -hex 32

# Update .env and restart
pnpm dev
```

### Agent Heartbeat Not Received

Ensure Agent on remote server has:
- Correct `AGENTTOKEN` from Server entity
- Network access to backend API
- Correct `ALLOWED_ORIGIN` set in backend .env

```bash
# Test connectivity from agent server:
curl http://localhost:3001/api/agent/heartbeat
```

### Memory Issues

```bash
# Check if running out of memory
free -h  # Linux
vm_stat  # macOS

# Limit Node.js memory
NODE_OPTIONS="--max-old-space-size=2048" pnpm dev
```

## Backup & Recovery

### Backup Database

```bash
# PostgreSQL dump
pg_dump $DATABASE_URL > backup.sql

# With compression
pg_dump $DATABASE_URL | gzip > backup.sql.gz
```

### Restore Database

```bash
# From dump
psql $DATABASE_URL < backup.sql

# From compressed
gunzip -c backup.sql.gz | psql $DATABASE_URL
```

## Performance Optimization

### Enable Query Logging

```bash
# In apps/server/.env, add:
DEBUG="prisma:*"

# Or set in code:
# const prisma = new PrismaClient({
#   log: ['query', 'info', 'warn', 'error']
# })
```

### Database Indexing

Key indexes are already configured in `schema.prisma`:
- `ServerMetric` — indexed on `[serverId, timestamp]`
- `AuditLog` — indexed on `[actorId]` and `[timestamp]`

### Frontend Performance

- TanStack Query handles caching
- Next.js image optimization enabled
- Code splitting automatic

## Deployment

### Production Deployment (GitHub Actions)

Deployment is fully automated via `.github/workflows/deploy.yml`:

1. Push to `main` → GitHub Actions triggers
2. Files are copied to VPS via sshpass + tar
3. `pnpm install && pnpm build` runs on VPS (sequential, 512 MB heap cap to avoid OOM)
4. `prisma migrate deploy` applies any new migrations
5. pm2 restarts `nextpanel-server` and `nextpanel-web`

**Required GitHub Secrets**: `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_PASSWORD`, `CERTBOT_EMAIL`
**Required GitHub Variable**: `DOMAIN`

### Manual Deploy (Emergency)

```bash
ssh root@<VPS_IP>
cd /opt/apps/nextpanel
git pull
pnpm install
find . -name "*.tsbuildinfo" -delete
NODE_OPTIONS="--max-old-space-size=512" pnpm -r --workspace-concurrency=1 build
cd apps/server && pnpm exec prisma migrate deploy && cd ../..
pm2 restart all
```

## Architecture Overview

### Request Flow: Login

```
User enters credentials
        ↓
Frontend submits to POST /api/auth/login
        ↓
NestJS AuthController validates password
        ↓
Generates JWT token
        ↓
Returns token + user info
        ↓
Frontend stores in Zustand auth store
        ↓
Subsequent requests include Authorization header
```

### Agent Heartbeat Flow

```
Agent on remote server
        ↓
Collects metrics (CPU, RAM, disk, network)
        ↓
Sends POST /api/agent/heartbeat with agentToken
        ↓
Server validates agentToken matches Server entity
        ↓
Updates Server.cpuUsage, memUsage, diskUsage, lastSeenAt
        ↓
Creates ServerMetric record for history
```

### Node Deployment Flow

```
User clicks Deploy (or opens deploy-stream drawer)
        ↓
POST /api/nodes/:id/deploy  OR  SSE /api/nodes/:id/deploy-stream
        ↓
NodeDeployService connects to node server via SSH
        ↓
Generates Xray/sing-box config from node settings + decrypted credentials
        ↓
For TLS nodes: issues/pushes Let's Encrypt wildcard cert via acme.sh
        ↓
Uploads config, sets up systemd service, opens firewall port
        ↓
Restarts service, runs end-to-end connectivity test
        ↓
Saves ConfigSnapshot + OperationLog (SSH terminal output)
        ↓
AuditLog records deployment action with correlationId
```

## Useful Links

- **Swagger API Docs**: http://localhost:3001/api/docs
- **Prisma Studio**: http://localhost:5555
- **Frontend**: http://localhost:3400
- **Backend API**: http://localhost:3001/api
- **Contributing Guide**: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
