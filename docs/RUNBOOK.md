# NextPanel Runbook

Last Updated: 2026-02-28

Quick reference guide for running, deploying, and troubleshooting NextPanel.

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- PostgreSQL >= 16 (or Docker)

### 30-Second Setup

```bash
cd /Users/zhouyixing/project/nextpannel

# Install dependencies
pnpm install

# Start PostgreSQL (if using Docker)
docker-compose up -d

# Setup backend environment
cp apps/server/.env.example apps/server/.env

# Initialize database
cd apps/server
pnpm exec prisma migrate dev --name init

# Start everything
cd ../..
pnpm dev
```

Then open:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001/api
- API Docs: http://localhost:3001/api/docs

## Running the Project

### Start Development Mode

```bash
# From project root
pnpm dev
```

This runs all services in parallel:
- `apps/web` — Next.js on port 3000
- `apps/server` — NestJS on port 3001

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

<!-- AUTO-GENERATED: From apps/server/.env.example -->

### Backend (.env file location: `apps/server/.env`)

| Variable | Type | Default | Description | Example |
|----------|------|---------|-------------|---------|
| `DATABASE_URL` | string | — | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/nextpannel` |
| `JWT_SECRET` | string | — | Secret key for signing JWTs (64 hex chars) | `410e9aa17d5da421837d934a829c75eb055187e4b367af6f49339e14a9d987e2` |
| `JWT_EXPIRES_IN` | string | `7d` | JWT token expiration duration | `7d`, `24h`, `30d` |
| `ENCRYPTION_KEY` | string | — | AES-256 encryption key (64 hex chars) | `f0737ba4e20d8b84eab76358bfde3a2160f61d005d1d7eac1a49abacda8f6d7b` |
| `PORT` | number | `3001` | API server port | `3001` |
| `ALLOWED_ORIGIN` | string | — | CORS origin for frontend | `http://localhost:3000` |

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

### Port 3000 or 3001 Already in Use

```bash
# Find process using port
lsof -i :3000
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

### Docker Deployment

Build images:

```bash
# Backend
docker build -f apps/server/Dockerfile -t nextpannel:server .

# Frontend
docker build -f apps/web/Dockerfile -t nextpannel:web .
```

Run with docker-compose:

```bash
docker-compose -f docker-compose.prod.yml up
```

### Environment for Production

Update `apps/server/.env` for production:

```env
DATABASE_URL="postgresql://prod-user:prod-pass@prod-db.example.com:5432/nextpannel"
JWT_SECRET="<very-long-random-string>"
ENCRYPTION_KEY="<very-long-random-string>"
PORT=3001
ALLOWED_ORIGIN="https://panel.example.com"
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

### Release/Deployment Flow

```
User creates Release from Template
        ↓
Specifies target servers and variable values
        ↓
System renders template config with variables
        ↓
Creates ReleaseStep for each target server
        ↓
Steps initially PENDING
        ↓
Agent on server polls /api/releases/pending
        ↓
Agent downloads config and deploys
        ↓
Agent reports back success/failure
        ↓
ReleaseStep status updates
        ↓
AuditLog records deployment action
```

## Useful Links

- **Swagger API Docs**: http://localhost:3001/api/docs
- **Prisma Studio**: http://localhost:5555
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001/api
- **Contributing Guide**: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
