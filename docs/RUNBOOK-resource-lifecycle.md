# Deployment resource lifecycle

## Scope

This change addresses real port collisions and resources forgotten by server deletion.
It does not automatically remove historical services whose ownership is unknown.
No production cleanup or deployment is implied by the local test results.

- Preset ranges are candidate pools. Allocation checks DB reservations, pending
  cleanup jobs, and live TCP/UDP listeners (IPv4/IPv6). Root SSH and `ss` are required.
  Missing tools, incomplete output or inaccessible owners fail closed.
- Deploy/start/certificate restart inspect socket ownership. Redeployment may reuse
  only the exact systemd unit's listeners. Unknown Xray processes are never killed.
  Deployment also verifies listeners after startup; managed chains need three
  successful end-to-end probes before commit. Failure restores saved deployments.
- Normal server deletion queues cleanup; force deletion additionally hides the server.
  Both atomically save entry/exit/DNS targets before removing node records. SSH
  credentials remain encrypted until all jobs finish and a final inventory is clean.
- Individual node deletion retains its existing synchronous, failure-preserving flow;
  it is not converted to the new background queue in this change.

## Ownership and reconciliation

New managed deployments record panel instance, host instance, server, node, role
and configuration fingerprint in `/etc/nextpanel/ownership/nextpanel-*.json`.
`/etc/nextpanel/host-id` pins the host across subsequent operations. An IP change
must not be used to silently adopt a different host. Do not copy these identities
when cloning a machine into a distinct host/panel.

Legacy cleanup is allowed only when the persisted approved config fingerprint
and exact managed systemd unit match. Missing evidence or a changed fingerprint
blocks cleanup. New manifests can identify a restored deployment after a failed
redeploy whose newer failure snapshot remains in the DB.
Config fingerprints are encrypted in the database rather than exposed as a
plaintext password oracle. DNS jobs retain their original zone ID and verify
zone access before deletion; changed settings must not produce a false "gone".

Cleanup is checked every 30 seconds, in batches of at most 10 jobs, under PostgreSQL
advisory locks. Entry, exit and DNS are independent tasks. A persisted 5-minute
lease recovers an interrupted RUNNING job; retry backoff is bounded to one hour.
Remote commands and DNS requests have explicit timeouts. BLOCKED jobs require
owner action; clicking retry never bypasses identity/ownership checks.

Agent chain-status reports contribute inventory (at most once per minute per host).
Allocation and explicit scans perform complete inventories. The read-only scheduler
scans up to five hosts every five minutes, including retired hosts. Missing entries
in a partial heartbeat never resolve a finding. Unknown services are report-only.
Final retirement independently requires a complete inventory; at most three hosts
are scanned per cleanup tick, with five-minute spacing on failed final scans.

The server page shows pending tasks, unknown services and unfinished retirements.
Links to retained server details allow credential repair. Only the owning user can
list/retry/scan their resources; task APIs do not return credential or payload data.
Each list is capped at 200 entries; it is not a fleet-wide completion certificate.

## Release and production acceptance

1. Back up the database, deployment config, affected remote units/configs and current
   listener/service inventory. Keep backups private; configs include credentials.
2. Apply the additive migration `20261031000000_resource_lifecycle` using the normal
   release pipeline. Start with `RESOURCE_CLEANUP_ENABLED=false` until the canary
   is reviewed. `RESOURCE_INVENTORY_ENABLED=false` can pause scheduled read-only SSH.
3. On an explicitly approved isolated Linux canary, exercise:
   - an occupied preset port, stats port, UDP port and multiple REUSEPORT listeners;
   - missing `ss`, hidden PIDs, disabled orphan units and ownership/host mismatch;
   - entry offline with successful independent exit/DNS cleanup;
   - worker termination/restart and replay of partly removed units/configs;
   - service restart/reboot, ensuring deleted units do not return;
   - failed deployment rollback of config, ownership manifest and new firewall rules.
4. Enable cleanup only after reviewing pending targets and ownership evidence.
   Verify website probe and real Clash client behavior separately. Existing unknown
   legacy services (including the incident's older chain units) require a separately
   approved exact allowlist; a scan alone never authorizes their deletion.

## Pause and rollback

- Set `RESOURCE_CLEANUP_ENABLED=false` and restart the API workers to prevent new
  cleanup work. Let in-flight operations terminate; review their persisted states.
- The migration is additive. Keep `PanelIdentity`, `ResourceCleanup`,
  `ResourceFinding` and the added Server columns during application rollback.
  Dropping them would erase deletion intent and ownership evidence.
- Do not resume old-version server/node write endpoints while retained retirements
  exist: the old hard-delete semantics can destroy credentials still needed by jobs.
  Keep management writes in maintenance mode or use a compatible patched release.
- Rolling back the application does not undo an authorized remote deletion. Restore
  the exact saved remote deployment only after pausing workers and reconciling the
  desired Node records; never restore a DB snapshot while cleanup continues.

## Local verification

```sh
pnpm lint
pnpm --filter @nextpannel/server exec jest --runInBand --no-cache
pnpm build
node --test scripts/tests/*.test.mjs
PG_BIN=/path/to/postgresql/bin node --test scripts/tests/database-integration.mjs
node scripts/tests/browser-smoke.mjs
```

The PostgreSQL harness creates a private Unix-socket-only cluster and never uses
the project's DATABASE_URL. It covers transactional failure, concurrent deletion,
two real advisory-lock workers, independent cleanup and stale-lease recovery.
Browser tests block external requests and use synthetic data at 1440px and 390px.
These checks do not substitute for the Linux/production acceptance above.
