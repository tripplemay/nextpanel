# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# From project root
pnpm install          # Install all dependencies
pnpm dev              # Start all services in parallel (web:3000, server:3001)
pnpm build            # Build all packages
pnpm lint             # Lint all packages

# Backend only (cd apps/server)
pnpm dev              # NestJS watch mode
pnpm lint             # eslint src --ext .ts

# Frontend only (cd apps/web)
pnpm dev              # Next.js dev on port 3000
pnpm lint             # next lint

# Database (from apps/server)
pnpm exec prisma migrate dev --name <describe_change>   # Create & apply migration
pnpm exec prisma db seed                                # Seed admin user
pnpm exec prisma studio                                 # Visual DB browser at :5555
pnpm exec prisma migrate reset --force                  # Reset DB (deletes all data)
pnpm exec prisma migrate status                         # Check migration state
```

No automated tests are configured.

## Architecture

**Monorepo layout** (pnpm workspaces):
- `apps/server` — NestJS 10 backend, port 3001
- `apps/web` — Next.js 15 frontend, port 3000
- `packages/shared` — Shared TypeScript enums and interfaces

**Frontend → Backend proxying**: `apps/web/next.config.ts` rewrites `/api/*` to `http://localhost:3001/api/*` (configurable via `API_URL` env var). All frontend `api.ts` calls use relative `/api` URLs.

### Backend (NestJS)

Follows standard NestJS module-per-feature structure. Each feature folder contains `*.module.ts`, `*.controller.ts`, `*.service.ts`, and `dto/` subdirectory.

**Modules**: `AuthModule`, `ServersModule`, `NodesModule`, `TemplatesModule`, `ReleasesModule`, `SubscriptionsModule`, `MetricsModule`, `AgentModule`, `AuditModule`, `PipelinesModule`.

**Authentication & Authorization**:
- `JwtAuthGuard` (`common/guards/jwt-auth.guard.ts`) — validates Bearer token on all protected routes
- `RolesGuard` (`common/guards/roles.guard.ts`) — checks `@Roles('ADMIN', 'OPERATOR')` decorator
- `@CurrentUser()` decorator extracts user from request
- Roles: `ADMIN` > `OPERATOR` > `VIEWER`

**Encryption**: `CryptoService` (`common/crypto/crypto.service.ts`) uses AES-256-GCM. Encrypted fields are stored with `Enc` suffix (`sshAuthEnc`, `credentialsEnc`, `githubTokenEnc`). Format: `base64(iv[12] + tag[16] + ciphertext)`.

**Agent communication**: Remote agents authenticate via `agentToken` (unique per Server). They poll `GET /api/releases/pending` and report via `POST /api/agent/heartbeat`.

**Pipelines module**: Manages GitHub Actions CI/CD integration — stores build/deploy commands, generates GitHub Actions YAML + webhook secrets via `GET /api/pipelines/:id/github-config`.

### Frontend (Next.js 15 App Router)

**Route groups**:
- `(auth)/` — login page (no auth required)
- `(dashboard)/` — all protected pages; layout enforces JWT presence client-side via `useAuthStore`

**State management**:
- `Zustand` (`store/auth.ts`) — persists `token` and `user` to `localStorage` via `persist` middleware
- `TanStack Query` — server state; configured with `staleTime: 30_000` and `retry: 1`

**API client** (`lib/api.ts`): Axios instance with request interceptor that injects `Authorization: Bearer <token>` from `localStorage`. Response interceptor redirects to `/login` on 401.

**UI**: Ant Design 5 with `zhCN` locale. `@ant-design/nextjs-registry` required for SSR compatibility. App wrapped in `<Providers>` (QueryClient + ConfigProvider + App).

**Component structure** (`components/`): Organized by feature — `servers/`, `nodes/`, `templates/`, `releases/`, `pipelines/`, `common/`, `layout/`.

### Database (PostgreSQL + Prisma)

Key schema relationships and encrypted fields:
- `Server.sshAuthEnc` — encrypted SSH key or password
- `Node.credentialsEnc` — encrypted JSON credentials
- `Pipeline.githubTokenEnc` — optional encrypted GitHub PAT
- `ServerMetric` — indexed on `[serverId, timestamp]` for time-series queries
- `AuditLog` — indexed on `[actorId]` and `[timestamp]`
- `ConfigSnapshot` — unique on `[nodeId, version]` for versioned configs

### Shared Package

`packages/shared/src/enums.ts` — All domain enums (`Protocol`, `Implementation`, `Transport`, `TlsMode`, `UserRole`, `ReleaseStatus`, `ReleaseStrategy`, etc.). Import as `@nextpannel/shared`.

## Environment Variables

Backend (`apps/server/.env`):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | 64 hex chars (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | Token expiry, default `7d` |
| `ENCRYPTION_KEY` | 64 hex chars, must be exactly 32 bytes |
| `PORT` | Server port, default `3001` |
| `ALLOWED_ORIGIN` | CORS origin, default `http://localhost:3000` |

Frontend (`apps/web/.env.local`):

| Variable | Description |
|----------|-------------|
| `API_URL` | Backend URL for rewrite proxy, default `http://localhost:3001` |
