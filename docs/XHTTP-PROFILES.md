# Managed CDN XHTTP profiles

## Supported matrix

| Preset | Client to CDN | Upload | CDN to origin | Probe contract |
| --- | --- | --- | --- | --- |
| `VLESS_XHTTP_TLS` (existing default) | TLS/H2 | packet-up | TLS/H2 | v3 |
| `VLESS_XHTTP_TLS` (opt-in) | TLS/H2 | stream-up | TLS/H2 | v4 |
| `VLESS_XHTTP_H3_TLS` (new) | TLS/H3 (QUIC) | packet-up | TLS/H2 | v4 |

Missing `xhttpAlpn` / `xhttpMode` keeps legacy H2 / packet-up behavior. Profiles
live in encrypted credentials, so no schema migration or bulk node rewrite is
needed. Existing WS, REALITY, identities, source ports and subscriptions are not
automatically modified. H3 + stream-up, auto, stream-one and alternate download
endpoints are deliberately not exposed in managed CDN presets.

New H3 nodes use the same isolated origin-port allocator, managed proxied DNS,
certificate checks and origin mapping as H2. H3 is **not** an origin UDP listener.
The subscription and website test connect only to a validated CF address with
the managed hostname as Host/SNI and certificate verification enabled. No H3 to
H2 or direct-origin retry is implicit. Keep a separate H2/WS node for fallback.

## Prerequisites and rollout

1. Publish the updated worker to **both Guangzhou and Chengdu**, retaining the
   reviewed Xray binary, secrets, function limits and existing cadence/budget.
   Check authenticated capabilities for v4 and both exact profile features.
   Packaging, publishing and live verification are separate release steps.
2. Keep `CF_XHTTP_PILOT_ENABLED=true` as the shared managed-XHTTP gate. It gates
   both presets; disabling it prevents new creations, not existing exports.
3. Enable HTTP/3 for the zone before H3 creation; enable gRPC before H2 stream-up.
   The panel requires Zone Settings Read and checks HTTP/3 or HTTP/2 (respectively)
   with GET-only requests before creation/update and again on deployment/retry.
   `settings/grpc` is not a supported Zone Settings endpoint (HTTP 400, code 1003,
   `Undefined zone setting: grpc`); HTTP/2 being on does **not** confirm gRPC.
   Check gRPC in the Cloudflare dashboard under Network. The panel never enables
   zone-wide settings automatically. Mapped nodes check their original zone.
   Ensure WAF allows the path; Cloudflare Access does not enforce authentication
   on gRPC traffic, so review other services before enabling the zone-wide toggle.
   Actual CDN transport acceptance remains mandatory before deployment commits;
   a failed mode switch restores the previous remote configuration and DB mode.
4. Create an independent H3 node or choose stream-up on an H2 preset. Existing
   H2 nodes expose mode editing without exposing identity/port/host mutation.
   Saving redeploys; changing mode requires clients to refresh subscriptions.
5. Validate real CF E2E, then two successful rounds from each registered region
   before treating optimized candidates as usable. Cached results are invalid
   after credential/profile changes. Old v3 workers cannot measure new modes.
6. Use current XHTTP-capable Mihomo/OpenClash and Shadowrocket (Base64 URI
   includes `mode` and `alpn`). Retain existing compatibility-profile filtering;
   client recognition is not proof of H3/network support. Verify on actual router
   and phone. Sing-box/HomeProxy still omit XHTTP rather than emit broken nodes.

H3 requires UDP/443 from client/probe to CF. Regional serverless measurements
are not residential-carrier results and do not guarantee faster mobile access.
Do not change the approved probe node allowlists or monthly batch limit as part
of merely publishing this feature.

## Rollback

- Failed mode redeployment uses existing remote-config/DB transactional rollback.
  If remote rollback itself fails, retain diagnostic state for manual recovery.
- To undo a successful stream-up switch, select packet-up and refresh clients.
- To undo H3, withdraw its subscription membership and use the retained H2/WS
  node. Remove the H3 node through managed cleanup, not by deleting files.
- Before downgrading the panel to a build without v4 profiles, switch stream-up
  back and withdraw/remove H3 nodes. Downgrading workers alone makes new-profile
  measurements unavailable; it does not transparently fall back to v3.

## Local verification and external gates

Server tests cover profile validation, read-only cloud preflight, transactional
mode rollback, exports, strict TLS and probe result identity. Native loopback
tests exercise Xray and Mihomo with all three profiles and reject wrong TLS
names. The H3 fixture explicitly changes its local peer to H3; it is **not** a
Cloudflare H3-to-H2 integration test. Browser fixtures use synthetic APIs only.
Production CF routing, SCF UDP access and real Shadowrocket/OpenClash usability
remain deployment acceptance gates, not conclusions from local tests.

References: [Xray XHTTP](https://github.com/XTLS/Xray-core/discussions/4113),
[Mihomo XHTTP](https://wiki.metacubex.one/en/config/proxies/transport/),
[Cloudflare HTTP/3](https://developers.cloudflare.com/speed/optimization/protocol/http3/),
[Cloudflare gRPC](https://developers.cloudflare.com/network/grpc-connections/).
