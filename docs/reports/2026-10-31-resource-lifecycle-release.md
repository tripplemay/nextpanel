# Resource lifecycle production release - 2026-10-31

Status: committed, pushed, merged through protected PR and deployed. Independent
release verification passed within the boundaries below. Destructive cleanup is
deliberately paused; the Linux cleanup canary and historical incident repair are
not claimed complete. All timestamps below are UTC.

## Release identity

- Production: `8d3e7cb1f99a6f09a9b0967ad811e4a3b8553e79`.
- Previous production: `15b542dc95caadac7d63092367afab4bc5d049b1`.
- Implementation: `96ae9c501606feee6a8f2776b11817f69e0ed026`.
- Review fix: `cd3f032c805b69a4fe856fadc6e6ec8c928da106`.
- [PR #7](https://github.com/tripplemay/nextpanel/pull/7), merged at 02:46:01.
- [PR validation](https://github.com/tripplemay/nextpanel/actions/runs/41161204200)
  and [production workflow](https://github.com/tripplemay/nextpanel/actions/runs/41161455421)
  both succeeded. Production `VERIFIED`: **02:54:43**.
- This follow-up report is documentation-only and does not trigger another
  deployment. Production identity is the SHA above, not a later documentation merge.

The PR retained strict required checks, administrator enforcement and resolved
review conversations. No force push, protection change or administrator bypass was
used. The 338 pre-existing mode-only worktree changes were not committed or reverted.

## Scope and rollout controls

- Live TCP/UDP port inventory, exact listener ownership and post-start verification.
- Durable server deletion intent, independent entry/exit/DNS cleanup tasks,
  ownership/config checks, retry backoff and retained SSH credentials.
- Read-only scheduled inventory and owner-isolated resource status/scan/retry UI.
- Additive migration `20261031000000_resource_lifecycle` applied successfully.
- Production `RESOURCE_CLEANUP_ENABLED=false` and
  `RESOURCE_INVENTORY_ENABLED=true`. All other environment settings were preserved.

The automated review found that transient DNS-zone verification errors could leave
cleanup permanently blocked. Network failures and HTTP 408/429/5xx now use bounded
retry; authorization/ownership failures remain blocked. DNS deletion still requires
successful verification. The fix passed the full gates before merge.

No Agent upgrade, token rotation, node deployment, remote service stop, firewall
change or DNS deletion was performed for this release. Existing excluded machines
were not reassigned. Read-only inventory never authorizes removal of an unknown unit.
New server deletions can queue durable work, but that work will not execute while
the cleanup switch is false.

## Verification evidence

| Boundary | Result |
| --- | --- |
| Final Linux CI | Lint, 48 suites / 940 backend tests, 42 script tests, native sing-box configuration checks, isolated PostgreSQL migration/restore/concurrency, types/build and 14 browser scenarios passed |
| Public requests | Before and after: 55/55 passed; 53 subscription exports retained identical SHA-256; 21/21 frontend static assets returned 200 |
| Data consistency | 20 users, 14 servers, 19 managed nodes, 2 external nodes, 8 subscriptions and 7 shares; user/session, node credential/config and external credential digests checked; subscription/share tokens unchanged |
| Metrics HTTP | 19/19 authorization, range, limits and real-data checks passed |
| Resource HTTP | 6/6 checks passed against the real API: anonymous denial, owner listing, foreign-owner isolation, foreign scan denial, missing retry target and authorized read-only Hong Kong scan |
| Cleanup pause | Safe unresolvable-target sentinel remained PENDING with zero attempts for 65 seconds across cron boundaries; fixture removed, no cleanup jobs left |
| Linux inventory | On the panel host, 41 socket rows parsed and one active managed unit's exact cgroup ownership verified; no destructive canary implied |
| Proxy probes | All 19 tested before and after: 10 available / 9 pre-existing failures, zero availability changes |
| Agent continuity | The same 9 previously healthy Agent 1.7.0 hosts remained ONLINE with fresh heartbeats |
| Process continuity | Panel API/web online with zero restarts; panel-host proxy PID/restart counters and unit/config digests unchanged; unrelated dash-pr process unchanged |
| Backup restore | Exact release dump checksum verified and restored into an isolated temporary database; entity counts, user/credential/token digests verified; temporary database removed |
| Environment | Only the two rollout flags changed; current environment matches release backup; backup directory 0700 and database dump 0600 |

The initial explicit scan used the panel host's saved SSH credentials and returned
HTTP 500. Server logs identified `All configured authentication methods failed`,
before any remote inventory command. A reachable, previously authorized Hong Kong
host was then used for the successful scan. The failed attempt was retained in the
evidence; credentials were not replaced and the panel-host scan is not claimed to
pass. Follow-up work: repair the saved credential and return a clearer recoverable
API/UI error for SSH scan failures instead of a generic 500.

### Availability observation

This was **not zero-downtime**. A single external observation path sampled login
and one Clash subscription from 02:38:46.942 to 03:01:15.418:

- 196 paired samples; 6 affected samples during cutover.
- First 502 at 02:54:00.898; last affected sample at 02:54:37.933.
- Both endpoints returned 200 at 02:54:44.535: approximately 40 seconds of observed
  interruption, bounded by the sampling interval rather than exact outage telemetry.
- All 58 post-ready samples passed. Successful subscription responses had one
  unchanged content hash throughout.

Real client connections in every region were not observed. Browser gates use
isolated fixtures; they are not authenticated production visual acceptance.

## Incident and remaining acceptance

- `dmit-hongkong-netflix` still failed the before/after proxy probe with curl exit
  code 52. The release prevents future unsafe allocation and preserves cleanup
  intent; it does not retroactively remove the incident's two obsolete exit units.
- Inventory reports unknown services without deleting them. Review the exact
  historical unit/config/host allowlist and authorize its cleanup separately.
  The 03:02 inventory had 8 open findings, including the two incident exit units
  and services on the previously excluded other-panel host. "Unknown" is not proof
  of an orphan; that excluded host's current panel ownership must remain intact.
- Before enabling the worker, run the isolated real Linux/systemd canary described
  in [the lifecycle runbook](../RUNBOOK-resource-lifecycle.md): conflicting sockets,
  missing inspection tools, ownership mismatch, partial/offline cleanup, interrupted
  workers, reboot persistence and rollback of units/configs/manifests/firewall rules.
- After incident remediation, repeat website probes and test the actual Clash
  client separately. Current protocol probes do not establish long-term stability.
- Individual node deletion remains synchronous; only server deletion was converted
  to the durable queue in this delivery.
- Low-downtime deployment remains a separate optimization; the measured cutover
  interruption must not be described as uninterrupted external service.

## Rollback

Release backup:
`/opt/backups/nextpanel/releases/8d3e7cb1f99a6f09a9b0967ad811e4a3b8553e79/`.
It contains the previous application/environment, database dump/checksum and
`VERIFIED`. The original environment before adding rollout flags is separately at
`/opt/backups/nextpanel/resource-lifecycle-20261031/server.env.before-rollout`.

The exact dump was restored in isolation; the live service was not rolled back just
to demonstrate recovery. If rollback is needed, first close management writes,
pause cleanup and wait for in-flight actions to settle. Preserve/export any new
deletion intent and ownership evidence before deciding whether a full DB restore
is safe. Application rollback alone must retain lifecycle tables and cannot safely
re-enable old hard-delete endpoints while retirements exist.

For the prepared full application/database recovery path:

```sh
bash /opt/apps/nextpanel/scripts/deploy-release.sh rollback 8d3e7cb1f99a6f09a9b0967ad811e4a3b8553e79
```

This restores the pre-release database and loses later writes, including later
cleanup intent and password/session changes. Rotate `JWT_SECRET` before reopening
to avoid reviving revoked sessions, and preserve the matching `ENCRYPTION_KEY`.
It cannot undo remote deletions. Do not restore a DB while cleanup is running.
See [release operations](../RUNBOOK-release.md) and the lifecycle runbook.

## Evidence locations

- Local: `out/release-resource-lifecycle-20261031/` (ignored by Git).
- Production: `/opt/backups/nextpanel/resource-lifecycle-20261031/` (0700).
- Original incident: `out/incident-dmit-hongkong-20261031/REPORT.md`.

Evidence includes workflow logs, before/after hashes, public samples, metrics and
resource HTTP checks, the failed SSH scan, inventory, proxy comparison and restore
verification. Raw token snapshots remain in private 0600 files and are not included
in Git, this report or PR messages.
