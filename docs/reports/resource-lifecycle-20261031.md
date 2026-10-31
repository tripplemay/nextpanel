# Resource lifecycle implementation - 2026-10-31

Status: implemented and locally verified; not committed, pushed or deployed.
No production host, process, firewall rule, DNS record or database was changed.

## Delivered

- Real TCP/UDP and IPv4/IPv6 port inventory during allocation, before deployment
  and after startup. Includes stats ports, pending cleanup reservations and
  duplicate listeners. Missing inspection tools fail closed; no process-name kills.
- Persisted server deletion intent, with independent entry/exit/DNS jobs and
  atomic intent-before-cascade ordering. Force deletion hides, not forgets, a host.
- Host/panel/config ownership checks, encrypted DB fingerprints, exact unit/config
  cleanup, retry backoff, restart recovery, and original DNS-zone retention.
- Final read-only inventory before deleting retained SSH credentials. Offline
  hosts and unresolved unknown services keep their registration and credentials.
- Agent inventory, bounded periodic SSH reconciliation, owner-isolated API,
  desktop/mobile cleanup status, guarded retry and retained-host credential repair.
- Worker pause switches and rollout/rollback procedure in
  `docs/RUNBOOK-resource-lifecycle.md`.

## Verification evidence

Artifacts: `out/resource-lifecycle-20261031/` (local, ignored by Git).

| Boundary | Result |
| --- | --- |
| Backend Jest, including actual HTTP/JWT routing with isolated persistence | 48 suites / 929 tests passed |
| Release/script regression | 42 tests passed |
| Private PostgreSQL cluster, full migrations and restore drill | Passed |
| Real PostgreSQL transactions, simultaneous deletes, two advisory-lock workers, stale lease recovery | Passed; SSH executor is a fixture |
| Production frontend/shared/server builds and TypeScript | Passed |
| Repository lint and diff whitespace | Passed |
| Local production frontend, external network blocked | 14 browser scenarios passed, including 1440px / 390px lifecycle flows |

Focused regressions cover incomplete socket scans, missing `ss`, REUSEPORT-like
multiple listeners, invisible owners, mismatched host/manifest/config, malformed
cleanup targets, port release before firewall cleanup, offline entry with reachable
exit/DNS, restored desired nodes, task retry authorization and retained credentials.

## Remaining acceptance, deliberately not claimed complete

- Real Linux/systemd canary: socket inventory, reboot persistence, timed-out SSH
  operations and end-to-end rollback. Local SSH/unit fixtures do not prove this.
- Review and separately authorize the exact historical orphan-service allowlist.
  Unknown services are never automatically deleted by this implementation.
- Production release, cleanup of the incident's obsolete chain deployments,
  repeated website probes and real Clash client testing remain pending.
- Individual node deletion keeps its existing synchronous flow; this delivery
  replaces server force-delete's loss of cleanup intent, not every delete API.

The existing 338 mode-only worktree changes were preserved. Dependency installation
was repaired using the frozen lockfile; no dependency or lockfile version was changed.
