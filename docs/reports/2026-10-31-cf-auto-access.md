# Automatic CF candidate development and legacy-source recovery

Date: 2026-10-31. Baseline: `5086002c73ae28ed9798d2cbc1e47d0763d285ab`.
Status: local implementation; not committed/pushed/deployed in this work item.
No production migration, subscription update, cloud function deployment, node
change or background-probe enablement has been performed.

## Recovered existing environment

Read-only Tencent console inspection located `gfw-check` in
`ap-guangzhou/default`, Nodejs 18.15, `index.handler`, 128 MB, 15 s timeout, public
outbound network with no VPC. Its creation/modification dates match the project's
March 8 GFW integration history. The original `index.js` implements only TCP
connect/time measurement. It has no WS/TLS/VLESS checks, throughput measurement or
carrier identification.

The user authorized switching to the old editor after the new editor stalled.
The deployed source was copied without edits, console Test or Deploy actions.
Normalized source, provenance and limitations are preserved at
`scripts/gfw-check/legacy/`. The attempted ZIP download did not produce a local
artifact; the cloud-reported archive hash is not a locally verified download.
An earlier GET returned 430; this does not test the original POST detection flow.
No claim of restored/broken legacy production detection is based on that GET.

## Implemented

- Additive `cfAuto=false` defaults and isolated candidate/state tables. Existing
  ordinary and manual CF subscriptions remain unchanged until explicitly edited.
- Reviewed official ranges, finite rotating discovery, bounded authenticated E2E
  probe requests, small download samples, two-pass admission/two-failure removal,
  hysteresis, backoff, per-probe daily reservations and stale-result expiration.
- Config/credential/probe identity binding; failed probe infrastructure does not
  poison all endpoint observations or write the node's ordinary health status.
- All measured carrier aliases in one subscription, generic/default-CF fallback,
  dynamic scoped Mihomo providers and per-carrier/all-carrier automatic groups.
  Provider changes cannot cause proxy-origin or DIRECT fallback.
- Owner-scoped status, atomic safe previous-snapshot rollback plus pause, explicit
  resume, UI automatic/manual choice, missing-carrier and worker-off warnings.
- Separate authenticated v2 worker source, native-runtime validation, Linux image
  template and rollout/rollback runbook. It does not overwrite the old function.

## Verification evidence

Final local gate: **PASS, exit 0**, `out/ci/cf-auto-verification.log`.
Backend: **51 suites / 1,059 tests**. Script/native tests: **51/51**.
Isolated PostgreSQL integration: **1/1**. Desktop/mobile browser fixtures: PASS.
The gate covers ESLint, Prisma schema/client, TypeScript, backend tests, script
tests, isolated PostgreSQL migrations/restore/concurrency, production builds and
1440/390 px browser fixtures. Snapshot/provider ownership, share revocation,
master-token rotation, safe rollback/resume and expired recovery rejection use
real disposable PostgreSQL rather than only mocks.

Native Xray config and sing-box/HomeProxy configs are checked with installed
binaries. Mihomo validates provider/group configuration and an isolated running
core verifies that all four empty CF groups contain/select only REJECT. External
rule downloads are excluded, HTTP providers are replaced with a local file and
health URLs with loopback. This is not a real remote provider-refresh acceptance.

Browser evidence: `out/ci/cf-auto-1440.png`, `out/ci/cf-auto-390.png`.
The tests intercept APIs and block external requests; the UI warnings intentionally
show unavailable real-carrier data rather than fabricated successful measurements.

## Not yet accepted / next release

1. Build the Linux image with reviewed Xray/base-image hashes, deploy a separate
   bounded SCF Web function and verify its actual HTTPS routes/auth/egress/runtime.
2. Register the existing region only as GENERIC until its actual carrier egress
   has independent evidence. Three real carrier environments are not established
   merely by finding this Guangzhou cloud function.
3. Apply the additive release, enable one pilot, verify the existing GFW POST
   flow and ordinary public subscriptions, then validate dynamic HTTP refresh,
   origin isolation and 24-48 h mainland peak/off-peak behavior.
4. Enable verified telecom/unicom/mobile labels only with recent circuit/egress
   evidence. The code supports all three; production three-carrier rankings have
   not been measured or delivered yet.

Rollback keeps CF-only: pause the scheduler or restore a safe previous pool; for
full feature rollback switch to manual with an empty preferred list and refresh
the full client configuration. Never downgrade live links to pre-CF-aware code.
See `docs/RUNBOOK-cf-auto.md` for exact boundaries and operator steps.
