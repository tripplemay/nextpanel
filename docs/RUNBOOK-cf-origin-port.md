# Cloudflare origin-port isolation

## Contract

This extension supports new managed VLESS + XHTTP + TLS nodes on hosts whose TCP
443 is occupied by a website, WS or another service. It does not migrate existing
nodes, change REALITY ports, adopt website configuration, reload Nginx, or change
zone-wide SSL/WAF settings. Existing compatibility links remain unchanged.

`Node.listenPort` remains the source listener. Nullable `publicPort=443` marks a
mapped endpoint; null preserves legacy behavior. Allocation prefers 443, then
8443, then 18000-18999, checking database reservations, pending cleanup and real
remote listeners, including the derived stats port, under existing host locks.

Clients connect to a verified Cloudflare IP on 443 with the original Host/SNI.
An exact-host Origin Rule changes only the source port. Cloudflare documents
[destination-port overrides](https://developers.cloudflare.com/rules/origin-rules/features/#destination-port)
and the [zone Origin Rules API](https://developers.cloudflare.com/rules/origin-rules/create-api/).
The implementation appends/deletes an individual owned rule, never PUTs the full
ruleset. Shared source IP does not require sharing the website's domain or port.

## Prerequisites and refusal conditions

- Keep the XHTTP pilot gate, reviewed Xray 26.10.31 and trusted certificate
  requirements. If the shared core has another version, deployment installs a
  checksum-pinned official build in `/usr/local/lib/nextpanel/xray-26.10.31/`.
  It never replaces or downgrades the shared binary. Supported isolated-core
  architectures are Linux x86_64/aarch64; curl and unzip must be available.
- A proxied, independently owned node hostname. An exact-host Configuration Rule
  sets `ssl: strict` for that node; the zone-wide SSL mode and website rules stay
  unchanged. This supports zones using Full for legacy self-signed WS services.
  Never lower TLS validation or change the website's zone settings automatically.
- Token scope for the original zone: DNS read/edit, Zone read, Zone Settings read,
  Origin Rules read/edit and Configuration Rules read/edit (API permissions
  `Origin Write` and `Config Settings Write`). Confirm both phase quotas before
  rollout. Use a zone-specific token rather than expanding a shared multi-zone token.
- Creation checks cloud access and host compatibility before persisting a node.
  Cloudflare Settings displays XHTTP read-only readiness separately from basic
  DNS access; a read-only success does not prove write permission or connectivity.
- On Debian 11+/Ubuntu 22.04+ with Linux 5.10+, root SSH and working distribution
  repositories, the streamed deploy can install missing nftables and allowlisted
  new library packages. It refuses package upgrades/removals and never starts
  the global firewall. Package plans and before/after rulesets are retained in
  `/opt/backups/nextpanel/nftables-bootstrap-*`. A temporary service mask prevents
  package activation; installation must leave the ruleset unchanged and the
  global service disabled/inactive. Present but unusable nftables, older kernels,
  unknown package dependencies and unsupported bootstrap systems are rejected,
  not silently replaced. Do not uninstall nft or remove ownership files before cleanup.
- Existing enabled Origin Rules must be provably disjoint exact-host rules.
  Broad/path/complex expressions are conservatively blocked for manual review.
  This does not automatically prove absence of effects from every other CF
  product (Page Rules, Workers, redirects, load balancing); inspect these in
  pilot preflight and use real end-to-end acceptance.
- Rule/DNS ownership, destination or zone drift is an error, not permission to
  overwrite another operator's configuration.

## Firewall and evidence

Only the new source TCP port receives a dedicated nftables inet table with
Cloudflare IPv4/IPv6 ingress restrictions. It does not flush the global ruleset
or restrict the website port. The unit's ExecStartPre reapplies its owned table;
deployment validates files, live table and a real TLS/H2 proxy request through
Cloudflare:443 before marking READY. Ordinary generic firewall opening remains
subject to the dedicated deny rule. Cloud security groups may separately need
the chosen source port opened to CF ranges after review.

The table is based on the versioned CF range list in `cf-access.util.ts`; it is
not a new dynamic range synchronization mechanism. Update/verify that list when
Cloudflare changes its ranges. External firewall resets can remove rules before
the audit notices; this is not protection against arbitrary root changes.

Every five minutes, the panel revalidates at most 20 running/enabled mappings,
oldest audit attempt first (persisted independently of Agent heartbeats).
Failed attempts advance this rotation without refreshing accepted evidence. Checks
include resource ownership/config, firewall, proxied
DNS, TLS mode and rule identity. READY evidence expires after 20 minutes; error
or stale mappings are withheld, never exported as direct origin fallbacks.
Configuration verification is not client throughput proof. A downloaded client
configuration is not revoked by panel-side withdrawal; refresh full subscriptions
and stop the pilot service when revocation is necessary.

The nodes page displays `443 -> source-port`, configuration state, last check,
rule registration and failure details. Subscription selection also recognizes
only fresh/accepted mappings. Normal WS candidates retain their old fingerprint.

Source hiding still needs independent acceptance: a DNS-only website on the same
IP, historical DNS, another direct node or using the entry as the exit can reveal
the source IP. This feature does not hide those paths or modify the website.

## Durable lifecycle

The panel saves original zone, full node hostname, deterministic ownership ref
and port before creating any external resource. DNS comments and Origin Rule
refs carry that ownership. Response-loss retries rediscover owned resources.
Failed creation keeps an ERROR node/intent visible; redeploy or delete that
record instead of creating repeated replacement nodes.
Hostname TLS rules use the deterministic `${originRef}_tls` reference and persist
their original ruleset/rule IDs. Lost responses are rediscovered, drift is not
overwritten, and cleanup removes only the owned TLS rule after the origin rule.
No operation replaces a whole configuration ruleset or changes global TLS.

Mapped creation performs read-only checks and returns the retained record; long
dependency preparation and cloud writes occur in the streamed deployment with
keepalives. Every retry repeats preflight before external writes. Only successful
end-to-end acceptance publishes the mapping. The isolated core is a shared,
versioned dependency cache, not a node service; node deletion does not remove it
while other nodes could still use it. Usage synchronization uses the deployed
unit's allowlisted core path rather than assuming the global binary.

Deletion first withdraws readiness, then removes only owned services/firewall
and Cloudflare resources. Partial failures retain the record for retry. Forced
server deletion persists ENTRY and independent CF_ORIGIN cleanup jobs, including
intents without returned resource IDs. Cloud cleanup does not require SSH and
uses the saved zone even if account settings later change. Original-zone token
access must be retained until cleanup succeeds. Never broadly delete records,
rulesets, processes or firewall tables as an orphan-cleanup shortcut.

## Release, acceptance and rollback

1. Complete lint, server/web builds, Jest, isolated PostgreSQL migration/cleanup
   tests and synthetic browser tests. The Linux CI job must pass
   `sudo node scripts/tests/cf-origin-firewall.fixture.cjs`; it uses private
   network/mount namespaces and exercises actual nftables with v4/v6 traffic,
   website coexistence, drift, restoration and idempotent cleanup. A macOS unit
   test is not a substitute. Cloudflare API fixtures are mocked, not live proof.
2. Before authorized release, back up DB/release and inventory website status,
   listeners, firewall manager/rules, zone rules/Workers/SSL, token permissions,
   Xray version and cloud security groups. Apply the nullable migration; do not
   infer that a successful panel deployment validates a source host.
3. Use one explicitly approved independent mapped pilot. Verify source-port
   isolation from an external non-CF network, v4/v6 behavior, unit restart and
   existing website/WS health against baseline. Test real Cloudflare routing,
   certificate checks, upload/download and subscription port/Host/SNI.
4. Preserve Guangzhou/Chengdu identities, tokens and URLs. The existing v3 worker
   contract already accepts client port 443; no worker code change is required
   solely for this mapping. Add only the approved pilot to regional allowlists
   within the existing four-node scope or a separately authorized temporary
   pilot. Require two successful rounds in both regions and fresh candidates;
   no implicit expansion of the 15-minute, CNY 30/month, 25000-batch limits.
5. Test the explicit XHTTP link on the approved OpenClash/Mihomo router. Retain
   WS and Shadowrocket compatibility. Observe peak-hour behavior before expansion.
6. Rollback: clients return to WS and refresh full subscriptions; remove the mapped
   pilot from subscriptions/probe allowlists, then stop/remove its owned resources
   with this release. Before restoring a panel that lacks publicPort semantics,
   ensure no mapped node can be exported by that build. Keep nullable columns;
   do not restore an old DB over new user data or drop ownership/cleanup records.
7. Verify original links, website and WS, both regions, public health and Agents.
   Keep cleanup failures and backups until independently resolved.

This implementation does not authorize production release, creation or cleanup.
Local success must be reported separately from CI/Linux and live pilot evidence.
