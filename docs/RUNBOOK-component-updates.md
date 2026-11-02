# Reviewed component updates

The 2026-11-02 reviewed targets are Xray 26.10.31, sing-box 1.14.4 and NextTrace
1.7.5. Updating the Agent does not update the installed third-party cores.

- Verify official archive digests before extracting executable candidates.
- Validate candidate binaries against existing node configs before replacing any
  installed binary. Preserve configs, credentials, certificates and subscriptions.
- Check both installed and `/proc/<MainPID>/exe` versions. A replaced file alone
  does not update its running processes.
- Hold the node lifecycle advisory locks during each backup/update/verification.
- Update one host at a time and test its real ingress, including chain exits.
  Keep the previous binary and unit definition until acceptance is complete.
- Updating shared Xray does not update an isolated XHTTP binary. New installs use
  `/usr/local/lib/nextpanel/xray-26.10.31/xray`; the previous managed 26.2.6 path is
  accepted only for usage synchronization during the rolling migration.
- Probe packages and CI must use the same reviewed Xray archive. Publish and
  verify Guangzhou and Chengdu separately, preserving authentication and budget.

## Security gates

The native Linux MPTCP fixture uses a private network namespace and syscall
traces with positive and negative controls. Older kernels/iproute2 combinations
can omit listening MPTCP sockets from `ss -M`; an empty listing alone is not a
security verdict. Reject production configs that explicitly enable `tcpMptcp`
until separately reviewed. Updating Xray is mitigation, not a kernel CVE fix.

New Xray also denies private destinations by default in Freedom outbounds. The
native WS/XHTTP tests explicitly allow only their synthetic loopback sink and
block everything else. These exceptions must never enter production generation.

## Independent panel Node runtime

Stage the official, checksum-verified Node 22 LTS distribution under
`/opt/apps/nextpanel-runtime/`. Activate its `current` symlink only after validating
the build and native dependencies. PM2 starts the two panel applications directly
with this interpreter; it does not replace the host Node or the shared PM2 daemon.
The release script uses the same runtime for build and migration commands.

Before activation, record the existing symlink (or its absence), Node path, PM2
configuration and deployed application. On a runtime-specific failure, stop only
the two panel apps, restore the former runtime selection and application config,
then restart and check readiness, subscriptions and background processing.

Database minor upgrades require a separately verified backup/restore and
maintenance window. Shared Docker/PM2, host reboots, and OS major migrations are
separate operations, not side effects of a core update.
