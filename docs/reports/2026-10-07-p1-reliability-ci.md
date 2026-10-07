# P1 reliability, metrics and CI gates

Date: 2026-10-07. Baseline: `363d0d5`.

Status: the three agreed P1 items are implemented and locally verified. This
checkpoint does not include commit, push, a GitHub-hosted run or production
deployment. The existing mode-only changes remain untouched. No database schema,
credentials, subscription tokens, Agent binary or production process was changed.

Release follow-up: the P1 implementation has since passed the GitHub-hosted gate and
been deployed. See [production acceptance](2026-10-07-p1-production-release.md) for
the exact production commit, observed maintenance window, independent checks and
rollback evidence. The verification section below preserves the local checkpoint.

## SSE terminal states

- A terminal business event, not HTTP EOF, determines success. Deployment streams
  require `done: true` with a boolean `success`; batch tests retain their existing
  `type: done` protocol. Explicit business failure, interruption and user cancellation
  have distinct outcomes. Missing/malformed terminal events cannot leave the UI running
  or report success. Terminal events stop reading immediately and settle once.
- The reader handles fragmented UTF-8, LF/CRLF/CR framing, multiline data and comments,
  validates the response type, limits buffered event size and releases its reader.
- Reset, replacement and unmount abort old reads. Request identity guards prevent
  late old responses/logs from overwriting a newer task. Batch cancellation is now an
  enabled action rather than an unclickable loading button, including the topology page.
- Drawer/log status distinguishes an interrupted connection from a confirmed remote
  failure. Closing a stream only stops receiving logs: it does not promise remote SSH
  cancellation. No automatic replay/retry of destructive operations was added.

Main paths: `apps/web/src/lib/sse-client.ts`, `apps/web/src/hooks/useDeployStream.ts`,
`apps/web/src/hooks/useNodeActions.tsx` and their drawer/log consumers.

## Metrics correctness and bounds

- Network rates use elapsed monotonic server receipt time instead of a fixed ten-second
  divisor. Counter resets are clamped independently, duplicate/reordered timestamps do
  not replace a newer baseline, and baselines are isolated per server and expired.
- First samples, process restarts and gaps longer than five minutes establish a fresh
  baseline and report zero until another sample arrives. This is monitoring, not a
  billing/accounting counter. Rates are receipt-time estimates; no new Agent payload
  or fleet upgrade is required. The baseline is process-local, matching the current
  single-instance backend; distributed multi-instance sampling remains separate work.
- `GET /api/metrics/servers/:id` retains its array shape, newest-first order and default
  60 points. `limit` must be an integer from 1 through 600, checked at HTTP and service
  boundaries. Invalid values return 400; owner isolation remains enforced.
- Optional `range=1h|6h|24h|7d|14d` aggregates in PostgreSQL, using the existing
  `(serverId,timestamp)` index and bounded time window/output. No full-history array is
  loaded into Node.js. UTC timestamp boundaries are independent of database session
  timezone, verified with an Asia/Jakarta database session.
- The server page offers these ranges, requests 120 aggregate points, separates cache
  keys by server/range and replaces snapshots so empty results clear stale charts.
  Buckets are received-sample means, not time-weighted traffic totals; missing periods
  are not filled with zeros. Existing retention cleanup is unchanged.

Main paths: `apps/server/src/agent/network-rate.ts`, `apps/server/src/metrics/`,
`apps/web/src/app/(dashboard)/servers/[id]/page.tsx`.

## CI and deployment gate

- `.github/workflows/validate.yml` is reusable by deployment, also runs on pull requests
  and supports manual validation. It has read-only repository permission and receives
  no production secrets. Node 22, pnpm 9.15.9, frozen dependencies, PostgreSQL 16 and
  Python Playwright 1.60.0 are specified.
- `deploy.yml` requires successful validation before its existing SSH deployment job.
  There is no `always()`/`continue-on-error` bypass. Failure injection tests prove the
  shell gate stops at backend tests, ops tests, builds, database tests, type checks or
  browser tests; workflow syntax/expression checking passes with actionlint.
- `scripts/ci/verify.sh` runs the same sequence locally and in CI. Database fixtures use
  their own Unix-socket-only cluster; browser API calls are mocked against a loopback
  frontend. The runner refuses an occupied frontend port, and cleans up its server.
- CI retains fixture-only logs for seven days. Direct SSH/manual CLI deployment and
  GitHub branch-protection settings are outside the automatic workflow gate; see
  `docs/RUNBOOK-release.md`. Existing Agent release checks are unchanged.

## Verification

The complete `scripts/ci/verify.sh` finished with exit code 0 in an isolated source
copy, using Node 22.22.0 and the existing installed dependencies. Project `.env` files
were excluded. A separate empty dependency directory passed pnpm 9.15.9 frozen-lockfile
validation (`--lockfile-only --ignore-scripts`); this is not a fresh Linux install claim.

| Gate | Result |
| --- | --- |
| Backend unit and real HTTP routing/JWT validation | 44 suites / 875 tests passed |
| SSE, restore/deploy scripts, ports and CI failure gates | 34 tests passed |
| Isolated PostgreSQL | Migration, wrong-key rollback, concurrency, compiled migration CLI and restore passed |
| Metrics database fixtures | Exact bucket means/boundaries, owner isolation, empty results, non-UTC session and 120,960-row bounded aggregation passed |
| Types/schema/builds | Prisma validation, backend/frontend type checks, shared/server builds, Next production build passed; 25 pages generated |
| Chromium security regression | 6 flows passed |
| Chromium P1 regression | 6 flows passed: desktop/mobile terminal states, late response race, batch cancel/restart, navigation cleanup and metric range/empty snapshot |
| Workflow and patch validation | actionlint, shell syntax and `git diff --check` passed |

Evidence: `out/p1-20261007/verification.log`, `browser-server.log`, `actionlint.log`
(ignored). Tests are checked in under `scripts/tests/` and backend `*.spec.ts` files.

## Remaining boundary

The local results above alone are not production acceptance; the linked release report
records the subsequent GitHub gate, deployment and independent external checks.
P2 subscription N+1 optimization, low-downtime releases,
durable task recovery/retry, alerts and previously excluded fleet machines are not part
of this P1 change set.
