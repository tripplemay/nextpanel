# Automatic CF candidates and shared regional subscriptions

## Scope and compatibility

Opt-in `cfAuto=true` supports mixed subscriptions: ordinary managed nodes and
external nodes remain unchanged. Only 1-20 owned managed VLESS+WS+TLS/443 nodes
with provisioned CF records are optimized. `cfOnly=true` remains a separate,
strict whole-subscription restriction; it cannot be switched off once enabled.
The additive migration
`20261031020000_cf_auto_optimization` defaults existing subscriptions to false.
Manual preferred IPs and ordinary subscriptions retain their previous behavior.
The UI defaults newly enabled strict CF-only subscriptions to automatic mode;
mixed subscriptions have an independent opt-in switch. No IP entry is needed.
Existing configurations are not silently converted.

Migration `20261031093000_cf_mixed_subscriptions` adds server-maintained
`cfProtectedNodeIds`, empty by default. Enabling/saving mixed automatic mode
captures the selected compatible node IDs. Disabling automatic mode retains
this scope and uses validated default CDN addresses. Configuration drift cannot
silently reclassify a protected node as direct: invalid/unavailable CF nodes are
omitted in mixed exports, while unrelated proxies remain available. An export
with no safe proxy still fails closed. Selection updates retain protection for
remaining members and use an optimistic updatedAt guard against concurrent
scope writes. Clients cannot set or clear the scope directly.

Each dynamic provider is limited to one protected owned node; it never includes
ordinary or external proxies. Mixed Clash selectors include both the CF groups
and ordinary/external entries, but CF groups never fall back to those entries or
DIRECT. Shared viewer responses redact protected origin IPs even with automatic
mode off. Non-CF proxies retain their original visibility and routing semantics;
mixed mode does not claim the entire subscription is CDN-only.

This does not redeploy nodes, change origin DNS/firewalls/ports, rotate tokens or
alter the old GFW function. The latter has been recovered under
`scripts/gfw-check/legacy/`. Only TCP detection is implemented there; it cannot
measure CF/VLESS availability or represent three mainland carriers.

## Scheduling / selection

- `CF_OPTIMIZATION_ENABLED=true` enables the scheduler; absent/false is off.
- One PostgreSQL session lock serializes cycles and rollbacks across app replicas.
  The cron wakes every five minutes; `CF_OPTIMIZATION_INTERVAL_MINUTES` selects
  a 5/10/15/20/30-minute UTC-aligned interval (default 5, invalid values stop work).
  Active auto-enabled nodes are visited oldest-attempt-first.
  A cycle stops starting new batches after three minutes; the current batch is
  bounded by its own timeout. Failures back off 5/10/20/40/60 minutes. Request-quota
  exhaustion waits until the next UTC day. Failed workers retain last good data.
- Official CF IPv4/IPv6 ranges are synchronized daily over fixed HTTPS URLs.
  Last-known-good ranges survive network errors; expansion beyond the reviewed
  SSRF boundary requires a code review, never automatic trust of a public feed.
- Each node/probe samples one rotating IPv4 address per approved range every six
  hours, plus current candidates and validated default DNS. This is bounded
  sampling, **not** an exhaustive scan or proof of globally fastest IP. No IPv6
  brute force; only existing/default IPv6 candidates can be checked.
- At most eight candidates/batch and three qualified pool endpoints/probe/node.
  Two recent consecutive successes promote; two failures remove an incumbent
  and cool it down six hours. Small changes do not churn a full pool: a challenger
  must improve by over 20%. Latency is used unless comparable recent throughput
  samples are available for all candidates; then throughput ranks first.
  The healthy first candidate is also retained until an alternative improves by
  over 20%; a failed primary yields to a healthy candidate. This prevents compact
  exports rotating their only regional slot for negligible measurement noise.
- Each probe has a durable UTC-day ceiling of 5,000 candidate tests and 100 MiB
  of **download payload reservations**, shared by all its nodes. Optional 1 MiB
  samples are refreshed no more than once/six hours/candidate. Download budget
  exhaustion still permits health checks. Failed reservations are not refunded.
  TLS/control traffic and connectivity responses are extra, so this is not a
  total egress/billing ceiling. Provision and monitor cloud limits separately.
- Results older than 30 minutes lose regional attribution and may be used only
  as generic candidates. After 24 hours they are omitted. Bad worker identity,
  changed node credentials/config, removed probes or non-CF addresses cannot be
  republished from old snapshots. Candidate tests do not update node health.

## Probe registry and honest regional attribution

### CNY 10/month pilot controls

For the approved single-node/single-generic-probe pilot, set:

```dotenv
CF_OPTIMIZATION_LOW_BUDGET=true
CF_OPTIMIZATION_MAX_MONTHLY_BATCHES=200
```

Low-budget mode visits nodes only at UTC 00:00/00:05, 08:00/08:05 and
16:00/16:05. This pairs promotion checks while reducing scheduled cloud work to
six batches/day for one node/probe. It is **not** continuous five-minute server
refresh. Client provider/health-check intervals remain unchanged, as do the
30-minute attribution and 24-hour hard expiry rules. This old pilot cadence is
not suitable for continuously fresh regional rankings.

The UTC-month ceiling is global across all nodes/probes. Each reservation is
durable and serialized by a separate PostgreSQL lock **before /capabilities**;
failed calls consume quota too. At the cap, no new worker calls occur and retry
waits until the next UTC month. A batch makes at most one capability call and
one measurement call. Zero disables new batches; invalid values fail closed.
Low-budget mode defaults to 200 when no explicit cap is supplied; otherwise an
unset cap preserves the original uncapped-month behavior. Never reset counters
to retry or remove the cap without reviewing the budget.

SCF settings: 512 MB, 120-second execution timeout, 65-second initialization
timeout, one maximum concurrency, no provisioned instances, no CLS delivery,
0.5 GB temporary storage. At the current published Web runtime price of
CNY 0.00011108/GB-second, the former allowance used two full 185-second calls per
batch: `200 * 2 * 185 * 0.5 * 0.00011108 = CNY 4.10996`. This is a conservative
timeout allowance, NOT an expected bill. Observed billing is substantially lower;
see [the settled-sample cost assessment](CF-PROBE-BUDGET.md). Do not assume a free tier. See the
[official SCF prices](https://cloud.tencent.com/document/product/583/12281).

**This is not a provider-enforced CNY 10 billing cap.** Application authentication
does not prevent SCF billing for rejected public requests, and external/manual
calls do not pass through the panel counter. Check the actual bill during the
pilot; pause the panel scheduler and freeze only this new function before
exceeding the budget. Never freeze or modify `gfw-check`. If a strict monetary
ceiling is required, keep scheduling off until a provider-side spend cutoff is
available and verified. No guarantee of a fastest IP or three real ISP exits is
made under this low-budget cloud pilot.

### Approved Guangzhou + Chengdu release target

The 2026-11-01 decision approves two regions, four existing compatible nodes,
15-minute probing and CNY 30/month. These are **release target settings**, not
evidence they have already been applied to production:

```dotenv
CF_OPTIMIZATION_LOW_BUDGET=false
CF_OPTIMIZATION_INTERVAL_MINUTES=15
CF_OPTIMIZATION_MAX_MONTHLY_BATCHES=25000
```

Normal demand is 23,040 batches/30 days or 23,808/31 days. The 25,000 global cap
includes failures and manual reservations, not 25,000 per probe or subscription.
The UI reports used/remaining quota and per-node scheduled demand. Regional
freshness stays 30 minutes; selecting a 30-minute interval risks jitter breaking
consecutive-success promotion. Fifteen minutes leaves confirmation headroom.
The monetary budget is not a provider-enforced cutoff: review the first 24/48-hour
bills, alert before CNY 20/25, and pause this probe workload before CNY 30. Do not
freeze the unrelated `gfw-check` function. No billing alarm is created by code.

### Registry

`CF_OPTIMIZATION_PROBES` is administrator-managed JSON (maximum nine probes):

```json
[
  {"id":"guangzhou-cloud","url":"https://GUANGZHOU_PROBE_HOST","tokenEnv":"CF_GUANGZHOU_PROBE_TOKEN","regionKey":"ap-guangzhou","region":"广州"},
  {"id":"chengdu-cloud","url":"https://CHENGDU_PROBE_HOST","tokenEnv":"CF_CHENGDU_PROBE_TOKEN","regionKey":"ap-chengdu","region":"成都"}
]
```

Inject a separate random 32+ character token into the referenced panel environment
variable and the worker's `CF_PROBE_TOKEN`. URLs must be HTTPS without embedded
credentials/query/fragment. Never put a token/UUID/subscription URL in Git or
screenshots. See `scripts/cf-probe/README.md` for the separate image package.

Reuse the existing Tencent account/Guangzhou function and add a separate Chengdu
v2 Web function. Do not overwrite `gfw-check`
or change `GFW_CHECK_FUNCTION_URL`. The existing 128 MB / 15 s event function is
not the proposed v2 runtime.

`regionKey` is the deployment-region identity, not a carrier, user location, or
Cloudflare POP. The worker reports SCF's built-in `TENCENTCLOUD_REGION`; an
explicit `CF_PROBE_REGION` must agree. Both capability and result responses must
match the registered key and `networkType=CLOUD` before publication. An optional
`expectedEgressIp` adds an exact egress check but does not establish residential
network representativeness. Never infer region from a URL, probe ID or ASN.

Optional `nodeIds` limits a probe to explicit managed nodes for a bounded pilot;
an empty list disables its scope. Omitted means all eligible nodes. A node's
exports/status show only probes in its scope. Keys must be safe stable slugs;
labels for the same key must agree. Probe/token/config changes invalidate old
snapshots; upgrade the worker before registering a regional identity.

Legacy registry objects remain accepted without rewriting their fingerprints.
Without `regionKey`, results are GENERIC regardless of old `carrier` fields.
Multiple probes in one region are aggregated by low failures, probe coverage
and normalized local rank; raw latency is not compared across regions. Missing
regions use only safe generic/default CDN fallback, never another region falsely
relabeled as local. The all-region group lets each client test all candidates.

## Subscription updates

- The background candidate pool still retains up to three qualified IPs per
  probe/node. Exports take only the highest-ranked IP from each measured region,
  plus one validated default CF address. When regions are missing, retain at most
  one generic fallback; omit that extra fallback when all regions are covered.
  With Guangzhou and Chengdu this is **at most three distinct endpoints per
  original node**, not seven or more. Nine regions need at most ten endpoints.
  This reduces client choices/probes, not the cloud probe cadence or quota.
  SNI, WS Host/path and CDN protection stay unchanged.
- Duplicate preferred IPs are one path, not multiple nodes. If several regional
  profiles select the same IP, export it once as GENERIC so cached regional groups
  can all use it without false single-region attribution. If it matches default
  CDN, keep only the existing DNS profile. De-duplication stays within the same
  managed node; different protocols, chains and independently managed nodes are
  never merged just because they share a server/exit address.
- Clash/Mihomo, Sing-box and HomeProxy expose **one all-region automatic group per
  managed node** in their main and service selectors. No regional subgroups are
  generated. Preferred paths and default CDN remain internal group members; the
  client chooses locally with a 50 ms tolerance, without asking users to choose
  among near-equivalent region/candidate entries. The original base group tag is
  unchanged to preserve existing selections. Raw provider/advanced/debug views
  may still show the underlying paths; Base64 cannot encode automatic groups and
  exposes only the bounded compact endpoints instead.
- Endpoint names keep `[CF-REGION:ap-chengdu]` and the terminal
  `[CF:GENERIC]`/`[CF:DNS]` compatibility marker. Cached carrier-era and regional
  groups still receive their safe region/generic/DNS paths after provider-only
  updates. The single new group also accepts pre-regional generic/default names
  on rollback, never the unavailable sentinel. Compaction is structural rather
  than relying on `hidden`, which requires client UI support
  ([Mihomo documentation](https://wiki.metacubex.one/en/config/proxy-groups/#hidden)).
  A **full subscription refresh** is required to replace the old group topology;
  refreshing only the HTTP provider cannot rename downloaded groups.
- Clash/Mihomo refreshes one scoped HTTP proxy-provider per node every 15 minutes
  and probes every five minutes. Provider URLs retain owner/share token scope;
  deleting a share or rotating its applicable token blocks future fetches.
  Empty provider groups explicitly contain REJECT, never an origin/DIRECT fallback.
  Still-authorized providers with no eligible endpoints return a `type: reject`
  sentinel with HTTP 200 to clear old entries. Its name matches no regional filter,
  leaving every group on REJECT. Mihomo rejects a literal zero-proxy HTTP update,
  so `proxies: []` alone would incorrectly retain the previous cached endpoints.
- Provider fetches use DIRECT to the **HTTPS panel control endpoint**, not to the
  proxy origin. Existing normal domestic/LAN DIRECT rules are unchanged.
- Sing-box/HomeProxy get static alias snapshots and URLTest groups; URI/Base64
  gets aliases only. Their client must enable periodic subscription refresh.
  Changes are not pushed into an already downloaded configuration.
- First enable/disable of auto mode, adding/removing original nodes, token changes
  or switching export format require a full subscription refresh. Dynamic provider
  refresh changes endpoints, not the downloaded topology/URLs. A removed/revoked
  provider may remain in a client's cache; revoking the actual proxy UUID is a
  separate credential operation, not guaranteed by subscription revocation.

## Release / rollback checklist

The regional refactor uses Prisma `profile @map("carrier")` for optimization
snapshots and usage credentials: **no physical column rename, data rewrite or
token rotation**. Legacy GENERIC/DNS credential keys remain stable. New regional
profiles create separate usage UUIDs only when observation is enabled; they are
published after server synchronization. Old UUIDs/history are not revoked by
this rename. Historical carrier profiles are shown as unclassified historical
candidates, never retroactively labeled as regional evidence. Deprecated API
`carrier=GENERIC` and `missingCarriers=[]` remain temporarily for loaded old admin
pages; new UI/code uses `profile`, `regions` and `missingRegions`.

The compact-export change also requires no migration or worker/Agent update.
It does not edit stored candidate pools or revoke old usage UUIDs. Retained
region/GENERIC/DNS endpoints keep their identity keys. When duplicate regional
paths merge into GENERIC, the normal observation reconciliation can create a new
GENERIC identity; until installation, the still-valid legacy CDN UUID is used.
Cached old identities remain valid. Deploy server and explanatory UI together,
then request a full client subscription refresh. A rollback to the regional
version restores the larger lists without changing node deployments or tokens.

1. Backup and record release; apply additive migration and matching generated
   Prisma/server/web code through the existing release pipeline. Leave scheduling
   disabled and existing subscriptions unchanged initially.
2. Build/review the separate Linux probe image with pinned binary/base hashes.
   Authorize new SCF resources, HTTPS access policy, secrets and resource budgets
   before deployment. Test unauthenticated 401, malformed/private input rejection,
   identity, timeout, cleanup and one actual E2E path. Do not log request secrets.
3. Upgrade Guangzhou and verify both regions' identities before registration.
   Initially scope Chengdu to one node with `nodeIds`, then expand only after two
   successes and budget validation. Enable one pilot subscription
   and scheduler. Observe at least two successful measurements and bounded quotas.
   Confirm old GFW POST detection and ordinary subscriptions still work.
4. Validate desktop/mobile exports, provider refresh, complete CF outage rejection,
   pending/missing regional coverage and the existing origin-secrecy audit in
   `RUNBOOK-cf-access.md`. Use actual mainland peak/off-peak testing for 24-48 hours
   before calling regional rankings accepted. Local fixtures are not that acceptance.
5. Per-node **rollback and pause** restores the previous safe unexpired snapshot
   atomically with a pause flag. Failed/non-CF/expired previous endpoints are not
   resurrected. A paused snapshot still expires; the UI shows the pause status.
   Resume is explicit. This affects all automatic subscriptions sharing that node.
6. Global stop: unset/set false `CF_OPTIMIZATION_ENABLED`; no new probes run. For
   feature rollback set the affected subscription `cfAuto=false`, clear
   `cfPreferredIps`, retain strict `cfOnly` and/or its mixed `cfProtectedNodeIds`
   scope, and refresh the full client subscription.
   Default CF DNS remains validated/pinned; no safe endpoint means export failure.
   Keep additive DB tables and the original GFW function unchanged.
7. Do not deploy pre-mixed application code over live mixed protection scopes:
   it ignores the new scope and can expose CF origins. A full rollback must use
   the matching pre-enable database backup, or explicitly migrate every protected
   subscription and client first. Do not roll back below a CF-aware application version while CF-only links are
   live. An earlier manual-CF build also lacks dynamic-provider routes, so migrate
   clients to manual/default CF exports before removing auto-provider support.

## Verification

```sh
PG_BIN=/opt/homebrew/opt/postgresql@17/bin \
  XRAY_BINARY=/path/to/xray MIHOMO_BINARY=/path/to/mihomo \
  bash scripts/ci/verify.sh
```

Tests include mixed owner/share exports, retained ordinary proxies, scope drift,
automatic-mode disable, provider isolation, mock probe-to-publication flows, actual isolated PostgreSQL defaults,
ownership/share/rotation/rollback, worker loopback HTTP, native config validation
and desktop/mobile browser fixtures. Mihomo tests also start an isolated core and
assert the single CF group selects REJECT after a populated loopback HTTP provider
is replaced with a reject sentinel. Frozen cached regional/carrier filters are
also tested through partial coverage, same-IP compaction, old-name rollback and
empty-provider replacement. Other fixtures use file providers and exclude
external rule downloads; they do not prove a live SCF
gateway, remote provider refresh timing or real ISP performance.
