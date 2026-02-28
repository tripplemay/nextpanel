# Contributing to NextPanel

Last Updated: 2026-02-28

This guide will help you set up the development environment and contribute to NextPanel.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** >= 20.0.0 — [Download](https://nodejs.org/)
- **pnpm** >= 9.0.0 — Install with `npm install -g pnpm`
- **PostgreSQL** >= 16 — [Download](https://www.postgresql.org/download/)
- **Docker & Docker Compose** (optional, for containerized PostgreSQL)
- **Git** — [Download](https://git-scm.com/)

## Project Structure

```
nextpannel/
├── apps/
│   ├── server/        # NestJS backend (port 3001)
│   │   ├── src/
│   │   │   ├── auth/          # JWT authentication & authorization
│   │   │   ├── servers/       # Server asset management
│   │   │   ├── nodes/         # Node configuration & deployment
│   │   │   ├── templates/     # Configuration templates
│   │   │   ├── releases/      # Release & deployment management
│   │   │   ├── subscriptions/ # Subscription distribution
│   │   │   ├── metrics/       # Server monitoring & metrics
│   │   │   ├── agent/         # Agent heartbeat receiver
│   │   │   └── audit/         # Audit logging
│   │   ├── prisma/
│   │   │   ├── schema.prisma  # Database schema
│   │   │   └── seed.ts        # Database seeding
│   │   └── main.ts            # Application entry point
│   └── web/           # Next.js frontend (port 3000)
│       ├── src/
│       │   ├── app/       # App Router pages & layouts
│       │   ├── components/ # Reusable React components
│       │   ├── lib/       # Utilities & API client
│       │   └── store/     # Zustand stores (auth, etc.)
│       └── next.config.ts
└── packages/
    └── shared/        # Shared TypeScript types & enums
        └── src/
            ├── enums.ts    # Shared enums
            └── types.ts    # Shared interfaces & DTOs
```

## Development Setup

### 1. Clone and Install Dependencies

```bash
cd /Users/zhouyixing/project/nextpannel
pnpm install
```

### 2. Set Up Database

#### Option A: Using Docker Compose

If you have Docker installed, start PostgreSQL:

```bash
docker-compose up -d
```

#### Option B: Local PostgreSQL

Ensure PostgreSQL 16 is running locally on port 5432.

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp apps/server/.env.example apps/server/.env
```

Then edit `apps/server/.env` and update the values:

- **DATABASE_URL** — PostgreSQL connection string (already configured for docker)
- **JWT_SECRET** — Random 64-character hex string for JWT signing
- **JWT_EXPIRES_IN** — Token expiration time (default: "7d")
- **ENCRYPTION_KEY** — 64-character hex string for field encryption (32 bytes = 64 hex chars)
- **PORT** — Server port (default: 3001)
- **ALLOWED_ORIGIN** — CORS origin for frontend (default: "http://localhost:3000")

Generate secure random strings:

```bash
# For JWT_SECRET and ENCRYPTION_KEY (64 hex characters)
openssl rand -hex 32
```

### 4. Initialize Database

Run Prisma migrations and seed initial data:

```bash
cd apps/server
pnpm exec prisma migrate dev --name init
pnpm exec prisma db seed   # Creates admin user (optional)
```

### 5. Start Development Servers

From the project root:

```bash
pnpm dev
```

This runs all dev servers in parallel:
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001/api
- Swagger Docs: http://localhost:3001/api/docs

## Available Scripts

<!-- AUTO-GENERATED: Run `pnpm -r run <script>` from root -->

### Root-level Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `pnpm --parallel -r dev` | Start all dev servers in parallel |
| `build` | `pnpm -r build` | Build all packages for production |
| `lint` | `pnpm -r lint` | Lint all packages |

### Backend Scripts (`apps/server`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `nest start --watch` | Start NestJS in watch mode |
| `build` | `nest build` | Build NestJS project |
| `start` | `node dist/main` | Start production build |
| `lint` | `eslint src --ext .ts` | Lint TypeScript files |
| `seed` | `ts-node -r tsconfig-paths/register prisma/seed.ts` | Seed database with initial data |

### Frontend Scripts (`apps/web`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev -p 3000` | Start Next.js dev server |
| `build` | `next build` | Build Next.js for production |
| `start` | `next start` | Start Next.js production server |
| `lint` | `next lint` | Lint Next.js project |

<!-- END AUTO-GENERATED -->

## Development Workflow

### Making Changes

1. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**

   - Backend changes go in `apps/server/src/`
   - Frontend changes go in `apps/web/src/`
   - Shared types go in `packages/shared/src/`

3. **Test your changes**

   ```bash
   # Run linting
   pnpm lint

   # Run server in watch mode
   cd apps/server
   pnpm dev
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: describe your changes"
   ```

5. **Push and create a pull request**

   ```bash
   git push origin feature/your-feature-name
   ```

### Code Style

- Use ESLint for code style checks
- Run `pnpm lint` before committing
- Follow existing code patterns in the codebase

### Database Schema Changes

When modifying the Prisma schema:

```bash
cd apps/server

# Create a migration
pnpm exec prisma migrate dev --name describe_your_change

# Review the generated migration file
# Push changes to database automatically
```

## Testing

<!-- Document test setup once implemented -->

Currently, the project does not have automated tests configured. This is a good area for contribution!

## Debugging

### Backend Debugging

NestJS watches for changes and auto-reloads. Check the console output for errors:

```bash
cd apps/server
pnpm dev
```

### Frontend Debugging

Next.js provides browser DevTools and server-side logging. Check browser console (F12) and terminal output.

### Database Debugging

Use Prisma Studio to inspect database:

```bash
cd apps/server
pnpm exec prisma studio
```

This opens http://localhost:5555 with a visual database browser.

## Common Issues

### Port Already in Use

If port 3000 or 3001 is already in use:

```bash
# Find what's using the port (macOS/Linux)
lsof -i :3000
lsof -i :3001

# Kill the process
kill -9 <PID>
```

### Database Connection Error

If you see connection errors:

1. Verify PostgreSQL is running
2. Check `DATABASE_URL` in `apps/server/.env`
3. Verify database exists: `psql -U postgres -c "SELECT version();"`

### Migration Fails

If migrations fail due to schema conflicts:

```bash
cd apps/server

# Reset database (WARNING: deletes all data)
pnpm exec prisma migrate reset --force

# Or manually fix conflicts and run:
pnpm exec prisma migrate deploy
```

### Node Modules Issues

If you encounter dependency issues:

```bash
# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## Architecture Overview

### Authentication Flow

1. User logs in with username/password via `POST /api/auth/login`
2. Server validates credentials and returns JWT token
3. Client stores token in auth store (Zustand)
4. Subsequent requests include `Authorization: Bearer <token>` header
5. JWT middleware validates token and extracts user info

### Data Flow: Creating a Node

1. Frontend user fills form and submits
2. Client encrypts sensitive fields (credentials)
3. API sends encrypted data to backend
4. Server validates and stores encrypted credentials
5. When deploying, server decrypts and uses credentials
6. Audit log records the action

### Release/Deployment Pipeline

1. User creates Release from a Template with variable values
2. System renders template with variables
3. Release is assigned to target servers
4. For each server, a ReleaseStep is created
5. Agent on each server polls and executes the release
6. Status updates flow back to UI in real-time

## Performance Considerations

- Database queries are optimized with proper indexing in Prisma schema
- Frontend uses React Query for efficient caching and background updates
- API includes pagination for large datasets
- Server metrics are stored and aggregated, not computed in real-time

## Technology Stack Details

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Frontend | Next.js | 15.1.3 | React framework with SSR |
| UI Library | Ant Design | 5.22.7 | Component library |
| State | Zustand | 5.0.2 | Lightweight state management |
| Data Fetching | TanStack Query | 5.62.16 | Server state management |
| HTTP Client | Axios | 1.7.9 | HTTP requests |
| Backend | NestJS | 10.4.15 | Node.js framework |
| ORM | Prisma | 5.22.0 | Database ORM & migrations |
| Database | PostgreSQL | 16 | Primary datastore |
| Auth | JWT + Passport | 10.2.0/0.7.0 | JWT authentication |
| Validation | class-validator | 0.14.1 | DTO validation |
| Package Manager | pnpm | 9+ | Monorepo workspace manager |

## Contributing Code

- Always create a new branch for your changes
- Write clear commit messages
- Update documentation if you change functionality
- Test your changes before submitting
- Ensure lint passes: `pnpm lint`

## Getting Help

- Check existing issues on GitHub
- Review documentation in `/docs` directory
- Look at API documentation: http://localhost:3001/api/docs
- Review test files for usage examples

---

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
