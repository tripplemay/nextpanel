# CDN XHTTP isolated pilot

## Scope and compatibility contract

This release adds `VLESS_XHTTP_TLS`, not a migration of existing WS services.
It uses Xray, verified TLS, Cloudflare proxying, port 443, and `packet-up` with
HTTP/2 on the client-to-CDN leg. XHTTP + REALITY remains a separate direct
transport and is not a substitute for the user's CDN-only requirement.

The upstream recommendation is from [Project X / Xray](https://xtls.github.io/config/transports/websocket.html),
not a blanket V2Fly removal of WS. The first phase deliberately excludes
stream-up/gRPC, HTTP/3, downloadSettings, custom extra options, and shared Nginx
443 routing. [XHTTP upstream design](https://github.com/XTLS/Xray-core/discussions/4113)
does not establish that a particular Cloudflare path or client is working.

| Entry | New managed XHTTP/TLS pilot | Existing WS |
| --- | --- | --- |
| Existing Base64 / Clash links | Not included | Unchanged |
| Base64 / Clash `?profile=xhttp` | Explicit opt-in | Included |
| sing-box / HomeProxy | Not included | Included |
| Single-node share link | Refused; use protected subscription | Existing behavior |

The same policy applies to owner and share tokens. No token rotation or user-agent
guessing is introduced. Existing REALITY/imported nodes keep their old export
behavior. A pure pilot subscription requested via an incompatible entry returns
503 instead of an empty configuration that could direct traffic outside the proxy.
The dynamic provider URL also carries the profile; do not manually reuse a cache
path between compatibility and pilot subscriptions. Provider exhaustion retains
the existing explicit rejection behavior.

OpenClash must use a verified Meta/Mihomo core; a plugin label saying "latest" is
not an exact core version. Local native acceptance uses Mihomo **1.19.29** and
Xray **26.2.6**, not the whole OpenClash router environment. Shadowrocket remains
on the original WS link until its exact build and actual phone behavior pass.
Do not remove the compatibility entry or schedule automatic WS retirement.

## Default-off gates

- `CF_XHTTP_PILOT_ENABLED=false` by default. Only the managed preset can create
  the pilot; the generic create/update API cannot convert a WS identity in place.
- The target host must have a free listen/stats pair, with database reservations
  and remote listener/ownership checks passing. Prefer 443; if occupied, the
  [origin-port mapping extension](RUNBOOK-cf-origin-port.md) selects an isolated
  port. Never stop WS, replace a reverse proxy, or share its systemd unit.
- The entry host must already have reviewed Xray **26.2.6** at the managed path.
  Deployment refuses missing/other versions rather than replacing a shared core.
  Upgrade any shared core only under a separate host inventory, backup and
  all-node configuration-validation gate.
- Active Cloudflare settings and a proxied DNS record are mandatory. Legacy DNS
  failure rolls back creation; mapped nodes retain an ERROR record and durable
  ownership intent for cleanup/retry. Trusted certificate issuance/renewal is required;
  no self-signed fallback or disabled certificate verification.
- Candidate export always binds CF IP + original domain Host/SNI. Even without
  subscription CF switches, managed XHTTP/TLS cannot export the origin address.
  No valid CF address means rejection, never origin fallback.

These gates do **not** prove that the origin is hidden. Before public use, apply
[source exposure acceptance](RUNBOOK-cf-access.md): historical DNS, firewall and
outbound identity must be checked independently. In particular, an entry that
is also the exit can reveal its IP to destinations. Use an independently checked
chain exit for the CDN-only pilot; do not silently waive `ENTRY_IS_EXIT`.

## Rolling release sequence

1. Capture panel release/environment/database backup and current probe packages,
   function versions, region identities and resource limits. Keep secret values
   private. Preserve existing server exclusions and untouched WS node identities.
2. Package the dual-contract worker, with the existing pinned Linux Xray archive:
   `node scripts/cf-probe/package-scf.mjs out/cf-probe/Xray-linux-64.zip out/cf-probe/cf-xhttp-pilot.zip`.
   The ZIP contains no credentials; keep the emitted manifest with release evidence.
3. Update **one** existing CF function at a time, Guangzhou then Chengdu. Do not
   edit `gfw-check`. Preserve tokens, URLs, probe IDs, region settings, instance
   limits, concurrency and timeout. Verify unauthenticated rejection, authenticated
   identity/capabilities and a real existing WS batch before proceeding.
4. Capabilities remain `protocol: 2` for old panels and add `protocols: [2,3]` plus
   `vless-xhttp-tls-packet-up-h2`. WS requests/results are still v2. An XHTTP request
   explicitly adds `protocol: 3`, `transport: XHTTP`, `mode: packet-up`; the result
   must echo them and the correct regional identity. A legacy/mismatched worker
   is an infrastructure error, not a bad-IP measurement.
5. Deploy the panel with the pilot gate **off**; validate public health, login,
   original owner/share links, two-region WS probes, Agents and representative
   unrelated protocols. The origin-port extension adds a nullable schema migration;
   follow its runbook before enabling mapped nodes.
6. Only after production pilot approval, inventory a managed host with a free listen/stats pair,
   review the core, source-hiding audit and rollback, then enable the creation
   gate and create **one** independent pilot identity. Do not mutate a WS node.
7. Add that identity to an explicit pilot subscription, enable CF auto selection,
   and include its node ID in the existing regional probe allowlists. Do not expand
   the registry to every node. Require two successful real XHTTP rounds from both
   regions and fresh candidates; capabilities/health alone are insufficient.
8. Import only the pilot link on the test router. Confirm core version, provider
   refresh, upload/download, reconnect, DNS and no origin fallback. Test mainland
   Telecom peak hours alongside unchanged WS for 24-48 hours. Record p50/p95 E2E
   delay, timeout rate, complete transfers and reconnect recovery; do not equate
   the cloud regions with residential carriers or assume XHTTP is faster.
9. Shadowrocket stays on WS until a separately recorded phone test succeeds.
   Keep WS at least 14 days after any later migration and until owners confirm.
   Website coexistence uses the origin-port extension, never shared Nginx 443.
   Stream-up A/B remains outside this scope.

Budget remains Guangzhou + Chengdu, 15-minute cadence, CNY 30/month and the
existing 25,000 global batch limit. Four baseline nodes nominally use 23,040
batches/30 days; one 48-hour pilot adds up to 384 scheduled batches, excluding
manual/extra rounds. Check actual remaining quota first. A fifth permanent node
would nominally exceed the current cap; do not leave the pilot scheduled forever
or raise limits implicitly. After 48 hours pause its automatic maintenance and
remove its allowlist entry pending the decision. Batch limits are not cloud bill caps.

## Rollback

1. Test clients switch back to the original compatibility link and refresh the
   entire subscription; ensure WS works before removing the pilot entry. Provider
   refresh alone does not remove groups from a cached full subscription.
2. Pause only the pilot's maintenance and remove its allowlist/subscription
   membership. Setting the creation gate false prevents new nodes but does not
   revoke already downloaded XHTTP credentials or stop existing pilot services.
3. Stop/remove the independent pilot only after verifying clients returned to WS.
   Use the normal owned-resource lifecycle, not broad process/config deletion.
   Preserve original WS UUID/path/domain, shared-core binary and certificate files.
4. If rolling back the panel to a pre-XHTTP build, first remove all pilot subscription
   memberships and stop pilot maintenance. Older builds do not understand the
   profile or implicit protection. Restore the earlier panel release; dual-contract
   workers can stay because old WS v2 still works. If a worker regresses WS, restore
   that function's saved version independently, without changing its token/URL.
5. Recheck both regions on WS, original links, origin exposure, public health and
   unrelated nodes. Keep the backup until rollback and client recovery are verified.

## Evidence boundaries

Local tests cover configuration, gate/ownership checks, strict exports, profile
isolation, worker v2/v3 contracts, browser fixtures, and real Xray/Mihomo TLS/H2
loopback upload/download with certificate-name rejection. No test calls production
CF endpoints, purchases resources or changes the existing Clash application.

Production function publication, live CDN routing in both regions, OpenClash
router/Shadowrocket phone acceptance, 24-48 hour soak and same-host coexistence
are separate pending release gates; a local build is not their completion.
