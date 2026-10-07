# Release and rollback gates

## Panel

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
