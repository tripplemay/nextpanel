# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# From project root
pnpm install          # Install all dependencies
pnpm dev              # Start all services in parallel
pnpm build            # Build all packages
pnpm lint             # Lint all packages

# Backend only (cd apps/server)
pnpm dev              # NestJS watch mode on port 3001
pnpm build            # Compile TypeScript
pnpm test             # Run all Jest unit tests
pnpm test:cov         # Run tests with coverage report
pnpm lint             # eslint src --ext .ts

# Run a single test file
cd apps/server && pnpm test -- --testPathPattern=nodes.service

# Frontend only (cd apps/web)
pnpm dev              # Next.js dev on port 3400
pnpm dev:clean        # Clear .next cache then start (fixes 404 after pnpm build)
pnpm build            # Production build (verify TS errors)
pnpm lint             # next lint

# Database (from apps/server)
pnpm exec prisma migrate dev --name <describe_change>   # Create & apply migration
pnpm exec prisma db seed                                # Seed admin user
pnpm exec prisma studio                                 # Visual DB browser at :5555
pnpm exec prisma migrate reset --force                  # Reset DB (deletes all data)
pnpm exec prisma migrate status                         # Check migration state
```

Swagger UI: http://localhost:3001/api/docs (when backend is running)

## Architecture

**Monorepo layout** (pnpm workspaces):
- `apps/server` — NestJS 10 backend, port 3001
- `apps/web` — Next.js 15 frontend, port 3400
- `packages/shared` — Shared TypeScript enums and interfaces (import as `@nextpannel/shared`)

**Frontend → Backend proxying**: `apps/web/next.config.ts` rewrites `/api/*` to `http://localhost:3001/api/*` (configurable via `API_URL` env var). All frontend `api.ts` calls use relative `/api` URLs.

### Backend (NestJS)

Follows standard NestJS module-per-feature structure. Each feature folder contains `*.module.ts`, `*.controller.ts`, `*.service.ts`, and `dto/` subdirectory.

**Modules**: `AuthModule`, `ServersModule`, `NodesModule`, `TemplatesModule`, `ReleasesModule`, `SubscriptionsModule`, `MetricsModule`, `AgentModule`, `AuditModule`, `PipelinesModule`, `OperationLogModule`.

**Authentication & Authorization**:
- `JwtAuthGuard` (`common/guards/jwt-auth.guard.ts`) — validates Bearer token on all protected routes
- `RolesGuard` (`common/guards/roles.guard.ts`) — checks `@Roles('ADMIN', 'OPERATOR')` decorator
- `@CurrentUser()` decorator extracts user from request
- Roles: `ADMIN` > `OPERATOR` > `VIEWER`

**Audit logging** — `@Audit` decorator + `AuditInterceptor` (registered globally as `APP_INTERCEPTOR`):
- Add `@Audit('CREATE', 'node')` to any controller method to auto-write an `AuditLog` after the handler returns
- The interceptor generates a `correlationId` UUID **before** the handler runs and stores it in `req.correlationId`
- SSE endpoints (`@Sse`) return `Observable` and cannot use the interceptor — they manually call `auditService.log()` with a self-generated `correlationId` and pass it into the streaming service

**Node deployment** — Two-path architecture:
- REST `POST /nodes/:id/deploy` → fire-and-forget (no stream)
- SSE `GET /nodes/:id/deploy-stream` → `NodeDeployService.deployStream()` returns `Observable<MessageEvent>`; frontend uses `EventSource` via `useDeployStream` hook
- SSH cleanup must succeed before DB deletion (SSH-first pattern)
- `NodeDeployService` generates node config via `nodes/config/xray-config.ts` or `nodes/config/singbox-config.ts` (selected by `nodes/config/config-generator.ts`)

**OperationLog / correlationId chain**:
- `OperationLog` stores SSH terminal output for each deploy/undeploy operation
- `correlationId` links an `AuditLog` record to its `OperationLog` record for UI drill-down
- `OperationLogController` routes: `GET /operation-logs/by-resource/:type/:id`, `GET /operation-logs/by-correlation/:correlationId`, `GET /operation-logs/:id`

**Encryption**: `CryptoService` (`common/crypto/crypto.service.ts`) uses AES-256-GCM. Encrypted fields use `Enc` suffix (`sshAuthEnc`, `credentialsEnc`, `githubTokenEnc`). Format: `base64(iv[12] + tag[16] + ciphertext)`.

**Agent communication**: Remote agents authenticate via `agentToken` (unique per Server). They poll `GET /api/releases/pending` and report via `POST /api/agent/heartbeat`.

**Pipelines module**: Manages GitHub Actions CI/CD integration — stores build/deploy commands, generates GitHub Actions YAML + webhook secrets via `GET /api/pipelines/:id/github-config`.

**Subscriptions**: `GET /api/subscriptions/link/:token` (V2Ray base64), `/clash` (YAML), `/singbox` (JSON). URI builders live in `subscriptions/uri-builder.ts`.

### Frontend (Next.js 15 App Router)

**Route groups**:
- `(auth)/` — login page (no auth required)
- `(dashboard)/` — all protected pages; layout enforces JWT presence client-side via `useAuthStore`

**State management**:
- `Zustand` (`store/auth.ts`) — persists `token` and `user` to `localStorage` via `persist` middleware
- `TanStack Query` — server state; configured with `staleTime: 30_000` and `retry: 1`

**API client** (`lib/api.ts`): Axios instance with request interceptor that injects `Authorization: Bearer <token>` from `localStorage`. Response interceptor redirects to `/login` on 401. All response types are defined in `src/types/api.ts`.

**UI**: Ant Design 5 with `zhCN` locale. `@ant-design/nextjs-registry` required for SSR compatibility. App wrapped in `<Providers>` (`app/providers.tsx`) — QueryClient + ConfigProvider (global `borderRadius: 8` token) + App.

**Frontend conventions** (enforced across all pages):
- All pages: `<Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>` wrapper
- All tables: `size="middle"` and `pagination={{ showTotal: (total) => \`共 ${total} 条\` }}`
- `<PageHeader>` renders its own `<Divider>` below the title — do **not** add `marginBottom` before tables
- Status display: use `<StatusTag status={...} />` (`components/common/StatusTag.tsx`), not local Badge/Tag combos

**Component structure** (`components/`): Organized by feature — `servers/`, `nodes/`, `templates/`, `pipelines/`, `subscriptions/`, `common/`.

Key shared components:
- `common/PageHeader.tsx` — title + add button + Divider
- `common/StatusTag.tsx` — colored tag with status color map
- `common/CopyButton.tsx` — copy-to-clipboard with feedback
- `nodes/DeployDrawer.tsx` — SSE terminal drawer (reused for deploy and delete)
- `nodes/DeployLogModal.tsx` — operation history modal (lists past deploy/undeploy logs per node)
- `hooks/useDeployStream.ts` — `EventSource` wrapper, URL-based for reuse

### Database (PostgreSQL + Prisma)

Key schema details:
- `Server.sshAuthEnc` — encrypted SSH key or password
- `Node.credentialsEnc` — encrypted JSON credentials (`{ uuid?, password?, method? }`)
- `Pipeline.githubTokenEnc` — optional encrypted GitHub PAT
- `OperationLog` — generalized resource model: `resourceType`, `resourceId`, `resourceName`, `operation` (string, not enum), `correlationId`, `log` (full SSH output)
- `AuditLog.correlationId` — links to `OperationLog.correlationId`
- `ServerMetric` — indexed on `[serverId, timestamp]` for time-series queries
- `ConfigSnapshot` — unique on `[nodeId, version]` for versioned configs

### Shared Package

`packages/shared/src/enums.ts` — All domain enums (`Protocol`, `Implementation`, `Transport`, `TlsMode`, `UserRole`, `ReleaseStatus`, `ReleaseStrategy`, etc.). Import as `@nextpannel/shared` (note double-n in the package name).

## Environment Variables

Backend (`apps/server/.env`):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | 64 hex chars (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | Token expiry, default `7d` |
| `ENCRYPTION_KEY` | 64 hex chars, must be exactly 32 bytes |
| `PORT` | Server port, default `3001` |
| `ALLOWED_ORIGIN` | CORS origin, default `http://localhost:3000` — set to `http://localhost:3400` for local dev |

Frontend (`apps/web/.env.local`):

| Variable | Description |
|----------|-------------|
| `API_URL` | Backend URL for rewrite proxy, default `http://localhost:3001` |

## Windows-Specific Gotchas

**Prisma DLL lock**: The running backend holds `query_engine-windows.dll.node`. Running `prisma generate` while the backend is alive will fail. Use `find-prisma-lock.ps1` at the project root to find the PID, then kill it before regenerating.

**.next cache conflict**: Running `pnpm build` in `apps/web` creates a production `.next` directory. Starting the dev server afterward causes 404 errors for static chunks. Fix: run `pnpm dev:clean` (which deletes `.next` first) instead of `pnpm dev`.

**Git Bash taskkill**: `taskkill /PID 1234 /F` fails in Git Bash because `/PID` is treated as a path. Use `cmd //c "taskkill /PID 1234 /F"` instead.
