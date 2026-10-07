# Security closeout: external credentials and account sessions

## Scope and delivery boundary

Implemented locally after the first security/correctness release. No commit, push,
production schema migration, token rotation, Agent upgrade or remote configuration
change has been performed for this package. The pre-existing mode-only worktree
changes are preserved.

SSE terminal-state handling, metrics/subscription performance, MFA, device inventory,
CI expansion and low-downtime deployment remain separate work.

## External credentials

- AES-256-GCM versioned envelopes bind credentials to the owning user. UUID, username,
  password, original URI, XHTTP extra and REALITY short ID fields are encrypted; normal list/rename and
  subscription-create responses use an explicit safe projection.
- Subscription generation and connectivity testing decrypt only on the authorized
  backend path. There is no runtime plaintext fallback, and corrupt/wrong-key records
  fail closed rather than silently producing broken or downgraded subscriptions.
- The new owner-only credential endpoint requires the current account password,
  rate limits requests to five per minute per tracker, sets `no-store`, and emits
  `CREDENTIAL_READ` through the existing audit interceptor. Passwords are redacted;
  response credentials are not part of audit diffs. Existing audit infrastructure
  records successful actions; durable failure-audit delivery is not added here.
- The UI keeps revealed values out of React Query and persistent browser storage,
  clears them by unmounting on close, aborts pending requests on unmount, and closes
  after 60 seconds. This is not a claim of physical RAM/clipboard erasure.
- The historical-data migration locks external-node writes, encrypts and verifies
  records in batches within one transaction, clears plaintext fields, and validates
  a constraint rejecting future plaintext writes. A wrong key/conflict rolls back
  all updates. Install/update/release entrypoints run it before backend restart.

## Session revocation

- Password and enterprise-WeChat logins include `tokenVersion`; JWT authentication
  compares it with current database state. Legacy versionless JWTs map to version 0
  only, preserving existing sessions until an explicit revocation.
- Password changes atomically update the hash and increment the version. Conditional
  updates prevent an already-revoked session or concurrent change from overwriting
  a newer password/version. Administrator seed-based resets also increment it.
- "Sign out other devices" rechecks the current password, increments the version and
  returns a replacement JWT to the initiating device only. Password changes clear
  the browser session/query cache and send the user back to login.
- The frontend serializes token rotation and waits out concurrent old-token 401s.
  Old responses cannot clear a successfully replaced session. A failed rotation
  releases waiting responses so a genuinely invalid session still logs out.
- Revocation affects future JWT validation, not already-running SSE/authorized work,
  proxy forwarding, subscription bearer URLs or Agent tokens. Passwordless WeChat-only
  accounts need a future OAuth reauthentication/initial-password flow to use the new
  password-confirmation actions; passwordless confirmation is deliberately rejected.

## Verification

Local verification on 2026-10-07:

- Backend Jest: 43 suites / 850 tests passed. The final safe-list fixture adjustment
  was additionally rechecked with all 22 external-node service tests passing.
- Prisma schema validation, backend compilation and frontend TypeScript: passed.
- Fresh isolated Next production build: passed, 25 pages generated.
- Operational shell tests: 9 passed, including both migration rollback branches.
- Real isolated PostgreSQL migration/concurrency/restore suite: passed, including
  the compiled production migration runner and wrong-key failure.
- Headless Chromium: six smoke flows passed at desktop/mobile sizes, including
  reveal expiry and both pre/post-response session-rotation races.
- Shell/Node syntax and `git diff --check`: passed.

Logs: `out/security-closeout-20261007/` (ignored, directory mode 0700; fixtures only).
The reproducible suites are:

```sh
# apps/server; does not start the application or contact the project database
./node_modules/.bin/prisma validate
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/jest --runInBand --no-cache --coverage=false

# Repository root; temporary isolated PostgreSQL, never project DATABASE_URL
node --test scripts/tests/*.test.mjs
PG_BIN=/opt/homebrew/opt/postgresql@16/bin node --test scripts/tests/database-integration.mjs

# Optional: also exercise the built production migration CLI in the temporary DB
PG_BIN=/opt/homebrew/opt/postgresql@16/bin SERVER_BUILD_DIR=/absolute/path/to/server/dist \
  node --test scripts/tests/database-integration.mjs

# Start a separately built local frontend first; all /api calls are fixture responses
python3 scripts/tests/security-closeout-browser.py http://127.0.0.1:3409
```

The backend suites include real HTTP routing/JWT/DTO/reauthentication/audit tests with
isolated in-memory persistence, encrypted import/export round trips, and owner/share
format equivalence. The real PostgreSQL suite covers historical-row migration,
wrong-key atomic rollback, idempotent reruns, SQL constraints, concurrent session
version updates, the compiled migration CLI, and database restore recovery. Shell
release tests cover both schema and credential-migration failure rollback.

The browser smoke covers desktop/mobile reveal, wrong-password recovery, close/reset,
automatic expiry, no persistent secrets, replacement-session races and password-change
logout. Frontend TypeScript and a fresh isolated Next production build are additional
checks, not production end-to-end acceptance.

## Release and rollback

Use `docs/RUNBOOK-release.md`. This is a coupled code/schema/data release with a short
maintenance interval, not a rolling mixed-version deployment. Preserve the existing
encryption key and a restorable database snapshot. A code-only rollback is unsafe.
Historical backups remain sensitive and must retain restricted access.

Before production acceptance, recheck public owner/share exports, two-session JWT
revocation, safe response projections and unchanged proxy forwarding. No assertion
of live external-network acceptance is made by this local delivery.
