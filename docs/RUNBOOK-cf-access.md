# CF-only subscription access (China Telecom pilot)

Automatic discovery and shared three-carrier subscriptions are documented in
[`RUNBOOK-cf-auto.md`](RUNBOOK-cf-auto.md). The manual-mode behavior below remains
supported; new automatic mode does not require entering preferred IPs.

## Boundaries

This is an opt-in subscription feature, not an origin migration or a promise of
China Telecom performance. Existing subscriptions default to `cfOnly=false` and
retain their previous output. No DNS records, firewall rules, remote units,
credentials, listener ports, or bearer tokens are modified by this feature.

CF-only limits proxy ingress to Cloudflare addresses. It does not prove that an
origin IP is secret: a single-server ingress/egress exposes its IP as the proxy
exit; DNS-only siblings, other services, historical DNS and firewall policy need
separate review. The UI always reports source hiding as **UNVERIFIED**. It must
not be promoted to accepted until the production audit and client tests below
have been completed. Any IP rotation, separate entry/exit deployment or firewall
restriction requires its own migration and rollback approval.

## Configure

1. Apply migration `20261031010000_subscription_cf_access` with the normal release
   procedure, then generate the Prisma client and deploy matching server/web code.
   The migration only adds `cfOnly=false` and `cfPreferredIps=[]` defaults.
2. Edit/create a subscription and enable CF-only. Select 1-20 owned, managed
   VLESS + WS + TLS nodes on port 443 with a managed Cloudflare DNS record.
   Other protocols and external nodes cannot share a CF-only subscription.
3. Enter zero to three literal CF IPs in preferred order. No URLs, custom ports,
   public preferred-domain feeds, private addresses, IPv4-mapped IPv6 or duplicate
   addresses are accepted. An allowlisted address is not necessarily a working
   CDN endpoint: check it with the actual node before recommending it.
4. Use the per-node/per-address check. This sends one bounded E2E HTTPS request
   via Xray, retaining the original SNI, WS Host, path, UUID and port. External
   SOCKS exits also retain the existing UDP check. The result is explicitly
   **PANEL**, not a China Telecom measurement. Checks do not overwrite the node's
   ordinary health result. One check per owner and five globally may run at once.
5. Update the client subscription. Confirm the CF-specific fallback group is
   selected in Mihomo/Clash; a manually selected individual endpoint cannot
   automatically switch itself.

## Export behavior

- Preferred endpoints are exported as `P1`-`P3`, followed by `DNS` when distinct.
  They are aliases of one node, not additional deployment resources.
- `DNS` is a **panel DNS snapshot**, not the client's local DNS decision. A/AAAA
  answers are checked against the CF allowlist, then one address (IPv4 preferred)
  is pinned in the exported configuration. A future gray-cloud change cannot
  make that downloaded configuration dial the origin. DNS is cached no longer
  than its TTL or 60 seconds, with bounded cache/in-flight sizes.
- Unsafe/failed default DNS is omitted; literal preferred CF endpoints remain.
  No usable address, no active nodes, or incompatible selection causes an HTTP
  error, never a replacement config that silently routes proxy traffic DIRECT.
- SNI and WS Host remain the node's domain; TLS verification remains enabled.
  The origin A/AAAA record is never repointed at a preferred edge IP.
- Mihomo uses ordered `fallback` groups. Sing-box/HomeProxy use `urltest` groups,
  not identical priority fallback semantics. Probes run every five minutes;
  healthy existing connections are not intentionally interrupted.
- URI/Base64 exports include separate endpoint aliases, without automatic group
  semantics. The receiving client must support its own selection/retry policy.
- Normal domestic/LAN direct-routing rules remain unchanged. CF-only constrains
  proxy endpoints and their fallback, not every destination in rule mode.
- Owner and recipient/share links support the same four export formats, including
  the shared HomeProxy route. Shared CF-only metadata omits the server IP field.
- CF IP ranges are a reviewed snapshot in `cf-access.util.ts`. Review changes at
  https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6 before
  changing the allowlist; never ingest an untrusted feed automatically.

## Production acceptance (still required)

1. Audit the pilot entry's DNS-only siblings (including records outside panel
   inventory), other directly advertised nodes/services and historical IP
   exposure. Verify that entry and exit public IPs differ if origin secrecy is
   required. Panel inventory checks are warnings, not a complete exposure audit.
2. Inspect and, with separate approval, restrict only the intended ingress port
   to CF origin traffic. Preserve SSH, Agent and unrelated services. Confirm CF
   edge-to-origin certificate verification; do not solve errors with insecure
   TLS. Never claim previously published addresses have become secret again.
3. On the user's real mainland China Telecom connection, record province/city,
   access type, IPv4/IPv6 availability, client/core version and test times. Do not
   upload subscription tokens, UUIDs, origin IPs or credentials with observations.
4. Compare the original domain-based client baseline, the pinned DNS snapshot,
   and each candidate using the same node, destination and time window. Perform
   at least 20 bounded connection tests per line in peak and off-peak windows,
   and limited throughput/long-connection tests. Set the download budget before
   starting; no whole-range scans or background automatic speed tests.
5. Observe 24-48 hours. Record success counts, timeout/error types, median/P95
   latency, throughput bytes/duration and unexpected disconnects. Small samples
   support pilot comparison, not a fleet-wide availability guarantee.
6. Test candidate failure and complete CF unavailability in an isolated client
   profile. Verify new connections use another CF endpoint or fail; verify there
   is no connection to the entry IP. Existing sessions need not migrate.
7. Compare ordinary subscriptions, bearer tokens and remote service/listener
   inventories before/after. Feature configuration must not create cleanup jobs,
   additional remote services or listen ports.

## Rollback

Clear `cfPreferredIps` and keep `cfOnly=true`, then refresh clients. This restores
the validated, pinned default CF address without weakening CDN-only protection.
If the default DNS is not CF, exports fail closed until DNS/CF access is repaired.
The CF-only flag is intentionally latched: it cannot be turned off by PATCH.
Existing downloaded configurations are not remotely revoked or replaced.

Do not roll a live CF-only subscription back to application code that predates
this feature: old code ignores the new fields and has legacy DIRECT fallbacks.
Use a feature-aware rollback build, or block the affected export routes before
an older-code rollback and explicitly manage client configuration recovery.
Keep the additive database columns; restoring the database or deleting original
proxy services is not a feature rollback.

## Local verification

```
pnpm --filter @nextpannel/server test -- --runInBand cf-access
PG_BIN=/opt/homebrew/opt/postgresql@17/bin node --test scripts/tests/database-integration.mjs
PG_BIN=/opt/homebrew/opt/postgresql@17/bin bash scripts/ci/verify.sh
```

The PostgreSQL harness creates its own Unix-socket-only disposable cluster and
never uses project DATABASE_URL. Browser fixtures intercept all API calls and
block external traffic. Native tests validate full sing-box/HomeProxy configs,
the Xray probe config, and Mihomo proxy/group sections (rule/GeoIP downloads are
excluded from that native syntax check). Xray/Mihomo native checks are skipped
when binaries are unavailable; sing-box is required by the release gate.
None of these fixtures constitutes production, mainland-network or failover
timing acceptance.
