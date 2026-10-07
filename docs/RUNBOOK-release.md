# Release and rollback gates

## Panel

`Deploy` first calls `.github/workflows/validate.yml`; its SSH job has
`needs: validate` and cannot start after a failed/cancelled validation job. Pull
requests run the same reusable checks without deployment credentials. Validation
uses Node 22, pnpm 9.15.9 with the frozen lockfile, PostgreSQL 16 and pinned Python
Playwright/Chromium. It runs backend HTTP/unit tests, SSE/ops/fail-closed gate tests,
ESLint correctness checks, type checks, production builds, isolated database migration/restore and browser
security/P1 flows. Fixture-only logs are retained for seven days.

The native configuration tests use sing-box 1.13.0. CI installs the official Linux
amd64 release with a checked-in SHA-256 pin before running the gate. `verify.sh`
requires the binary and sets `REQUIRE_SING_BOX=1`; a missing binary is a failure,
not a skipped test. Install this version locally before reproducing the full gate.

`pnpm lint` checks server, web and shared TypeScript with ESLint 9 / typescript-eslint
and React Rules of Hooks. It fails on errors and warnings. This initial gate does
not enforce unused-variable cleanup, banning all `any`, exhaustive hook dependencies
or type-aware lint rules; TypeScript remains a separate mandatory gate. Scoped
exceptions preserve intentional control-character validation, lock-loss failures,
disabled enterprise OAuth UI and Jest mock loading. Runtime package versions are
unchanged; the package manager is pinned to the same pnpm 9.15.9 as CI.
Supported Node runtimes are 20.19+ within 20.x, 22.13+ within 22.x, or 24+.
The manifest and `.npmrc` enforce this during installation; the standalone installer
rejects older existing runtimes before application installation and installs Node 22
when Node is absent. It does not silently upgrade an existing shared-host runtime.

Reproduce the gate in a clean checkout with dependencies and Chromium installed:

```sh
python3 -m pip install -r scripts/tests/browser-requirements.txt
python3 -m playwright install chromium
PG_BIN=/path/to/postgresql/16/bin bash scripts/ci/verify.sh
```

The database tests require a non-root user, create their own Unix-socket-only
cluster and never use the project database. The frontend smoke starts its own
loopback-only server and mocks API requests. `verify.sh` deliberately overrides
`DATABASE_URL` and `API_URL` with non-serving fixture addresses. Prefer an isolated
checkout because Prisma generation and production builds write generated artifacts.
The workflow gate does not enforce manual SSH/CLI operations outside GitHub; those
operators must run it before a release. Branch protection remains a repository
setting, not something this workflow silently changes. Required check names must
match the successful pull-request check (`checks`, GitHub Actions app 15368), not
only the reusable deployment label (`validate / checks`). Require up-to-date PR
branches, include administrators, prohibit force pushes/deletion, and resolve review
conversations before merging. Keep required approvals at zero for the current
single-maintainer workflow; CI remains mandatory. Repository protection does not
restrict a host administrator's direct SSH access.

`Deploy` stages a full commit in an isolated directory, installs the frozen lockfile,
generates Prisma and builds before stopping either production process. SSH host keys
must be pinned in `SSH_KNOWN_HOSTS`; the job fails closed when it is missing.

After stopping only `nextpanel-server` and `nextpanel-web`, it snapshots the dedicated
`nextpanel-postgres` database, preserves the entire previous app directory and environment,
switches directories, migrates, and checks web login plus database readiness. Errors
after switching trigger automatic database and application rollback. A deployment is
serialized by both GitHub concurrency and a host-side lock.

Backups: `/opt/backups/nextpanel/releases/<full-commit-sha>/` (root-only).
No reverse proxy, TLS certificate, proxy-node binary/configuration or unrelated PM2 app
is changed. The panel has a brief maintenance interval; node forwarding continues.

Manual rollback on the production host (stop concurrent operations first):

```sh
bash /opt/apps/nextpanel/scripts/deploy-release.sh rollback <full-commit-sha>
```

Rollback replaces the **dedicated NextPanel database** from its snapshot and discards
post-snapshot writes. It also restores the previous subscription tokens. Distribute
client updates only after release acceptance. If database restore fails, keep the panel
stopped; never mark a rollback successful from PM2 status alone.

## External credential and session migration (2026-10-07)

The `20261007020000_security_closeout` schema migration must be followed by the
application data migration **before restarting the backend**. `deploy-release.sh`,
`nextpanel update` and `install.sh` run both steps automatically. Do not deploy only
the frontend, restore only the old executable, or start an old backend against the
new constraint: old plaintext writes are rejected and old exports cannot read the
encrypted records.

For a manual release, first build the matching server and Prisma client, stop backend
writers, and snapshot the database plus the existing environment. From `apps/server`:

```sh
pnpm exec prisma migrate deploy
node --env-file=.env ../../scripts/migrate-external-secrets.cjs
```

Use Node 20.6+ and the **existing** `ENCRYPTION_KEY`; do not regenerate it during this
upgrade. The runner encrypts UUID, username, password, raw URI, XHTTP extra data and
REALITY short ID, verifies decryption, clears the six legacy fields, and validates the DB constraint
in one transaction. Reruns verify existing ciphertext. Failure rolls back the data
transaction and must keep the backend stopped. The release transaction additionally
restores the previous code and database snapshot on failure. Large inventories may
require a longer maintenance window; the data transaction timeout is five minutes.

Release acceptance additionally requires:

- List, rename and subscription-create responses contain neither plaintext external
  credentials nor `credentialsEnc`.
- Owner-only credential reveal rejects missing/wrong passwords and other users,
  returns `Cache-Control: no-store`, and records a redacted credential-read audit.
- Existing owner/share URLs export equivalent connection parameters in supported
  formats; no subscription token rotation is part of this migration.
- Two independent logins: password change rejects both old JWTs; "sign out other
  devices" rejects both old JWTs while retaining its replacement JWT.
- Run external subscription smoke and compare node forwarding against the saved
  baseline. Local tests do not substitute for these production checks.

Legacy JWTs without a version remain valid while `User.tokenVersion` is zero; password
change, administrator password reset through seed, or session revocation increments it.
Already-authorized requests/streams are not forcibly cancelled; subsequent JWT checks
reject the old version. Revocation does not rotate Agent tokens or subscription links.

Rollback after users have resumed writing restores earlier passwords/session versions,
not just earlier code. If an accepted security release must be rolled back, block public
panel access during the rollback and rotate `JWT_SECRET` before reopening it, forcing a
fresh login. The old release restores its historical security limitations; this is not
a security-equivalent rollback. Keep `ENCRYPTION_KEY` paired with the chosen DB snapshot.

Old dumps, release directories, WAL and storage snapshots can still contain historical
plaintext. Restrict/encrypt their storage and expire them under the backup retention
policy; clearing live columns does not securely erase historical copies. Never print
decrypted values or copy them into deployment logs/reports.

## Legacy Agent SSH migration

`scripts/fleet-ops.cjs` runs from `apps/server` with Node's `--env-file=.env` option.
Use `snapshot`, `audit`, and `probe` before touching the fleet. Artifact directories must
be private: snapshots contain subscription bearer tokens. Host fingerprints discovered
in the audit are pinned for all later actions. Do not upgrade agents whose token belongs
to a different panel, even if SSH access is available.

Save the GitHub release API JSON as `release.json` and download its architecture-specific
assets into that same private directory. `upgrade <artifact-dir> <server-id>` checks the
published digest, architecture and version, backs up the binary/config/unit, arms an
independent 240-second rollback timer, replaces only the Agent binary, and waits for the
new version's database heartbeat. Confirmation also requires unchanged node processes,
restart counters, service units, configuration hashes and proxy-core hashes.

First run `drill <artifact-dir> <canary-id>`: upgrade, verify heartbeat, explicitly roll
back, verify the old heartbeat and unchanged proxy processes. Then perform the normal
upgrade. A local panel-host Agent may be selected with `LOCAL_SERVER_ID`; the script
requires that its inventory IP is actually assigned to this host.

Each host retains `/opt/backups/nextpanel-agent/release-agent-v<version>/` (dots replaced
with hyphens). For an operator-requested rollback after confirmation, remove only that
release's `CONFIRMED` marker and run its preserved `upgrade.sh rollback <directory>`;
verify the old binary digest, real heartbeat and unchanged proxy processes afterward.

`public-smoke.mjs` validates external login/auth boundaries and all owner/share formats
without printing credentials. Supply the old snapshot as the final argument after token
rotation to verify old links are rejected. Client devices still need their owner URLs
replaced; unchanged share URLs do not require that update.
