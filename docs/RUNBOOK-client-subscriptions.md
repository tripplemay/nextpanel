# Client-aware XHTTP subscriptions

## Existing URLs

Owner and shared Base64/Clash links now resolve the default `auto` profile from
the request's client product/version. No subscription token changes are needed.
The service still defaults to `compatible` when called without HTTP client context.

- `profile=auto` or no profile: known capable clients receive CDN XHTTP plus
  their existing nodes. Unknown clients keep the previous compatibility output.
- `profile=xhttp`: explicit selection for a capable client with a hidden,
  customized or unrecognized User-Agent.
- `profile=compatible`: explicit rollback; no new managed CDN XHTTP nodes.
- sing-box/HomeProxy routes always retain their format's compatibility rules,
  regardless of User-Agent or query. They cannot be made XHTTP-capable by changing
  a label or serializing an unsupported transport.

Client identity is a presentation hint, not authentication. The same owner/share
authorization, protected Cloudflare-only endpoints, TLS/SNI/Host checks and
fail-closed empty-result behavior apply to every profile. A spoofed User-Agent
cannot obtain another subscription or an origin fallback. Successful public
Base64/Clash/provider responses are private/no-store and vary on User-Agent.
Dynamic provider URLs pin the resolved profile, including explicit compatibility,
so a different provider downloader cannot change the parent's capability choice.

## Automatic selection policy

These are conservative selection baselines, not claims about the oldest usable
release, nor proof of every app's import/runtime behavior:

| User-Agent product | Automatic XHTTP baseline |
| --- | --- |
| Shadowrocket | Semantic version 2.2.67+ |
| Shadowrocket numeric build | 3488+ (this rollout's observed client build) |
| Mihomo / Clash.Meta | Semantic version 1.19.22+ |
| Mihomo / Clash.Meta alpha | Exact reviewed `alpha-gbc76c13` build only |
| Xray | Semantic version 24.11.30+ |
| v2rayN | Semantic version 7.3.0+; Xray core required for XHTTP |
| v2rayNG | Semantic version 1.9.24+ |

Shadowrocket's numeric build is not converted to a guessed App Store version.
Older opaque builds, unknown alpha hashes and wrapper-only names (for example
Clash Verge without its core version) remain compatible; use the explicit XHTTP
link after verifying the actual core/app. No fuzzy matching of arbitrary text
or version strings is used. Numeric build 3488 was observed on this panel's
subscription requests; phone-side import and connectivity remain a separate
acceptance step and must not be reported as proven by server-side tests.

Primary sources checked on 2026-11-01:

- [Shadowrocket version history](https://apps.apple.com/us/app/shadowrocket/id932747118?l=en-us&platform=ipad): XHTTP introduced in 2.2.67; later versions include fixes.
- [Mihomo 1.19.22](https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.22): XHTTP transport support.
- [Deployed alpha VLESS implementation](https://github.com/MetaCubeX/mihomo/blob/bc76c1398c6e70089367a30169d0df7c7f77c42d/adapter/outbound/vless.go): XHTTP transport/options.
- [Xray 24.11.30](https://github.com/XTLS/Xray-core/releases/tag/v24.11.30), [v2rayN 7.3.0](https://github.com/2dust/v2rayN/releases/tag/7.3.0), [v2rayNG 1.9.24](https://github.com/2dust/v2rayNG/releases/tag/1.9.24): XHTTP transport/mode support.
- [sing-box transport schema](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/): no upstream XHTTP transport.

## UI and verification

The main subscription links remain unchanged. Each relevant client tab contains
collapsed manual-XHTTP and compatibility rollback links; the dedicated XHTTP tab
also supplies both Clash YAML and Shadowrocket/Xray Base64. Hiddify is no longer
universally recommended for subscriptions that may include XHTTP.

Before release, test owner and shared URLs with supported, old and unknown
User-Agents, plus explicit overrides, malformed queries, provider downloads and
unsupported format requests. Verify CF IP/public 443, domain Host/SNI, packet-up,
H2, no origin/credential leakage, and unchanged existing WS paths. A pure XHTTP
subscription requested by an unsupported client must fail closed, never become
an empty or DIRECT configuration.

After release, fetch the existing private subscription URLs using the actual
client User-Agent (do not print tokens/UUIDs), validate returned entries and
perform bounded native connection tests. Then ask the user to refresh the
subscription on the actual phone/router and confirm import plus real browsing.
Do not infer that phone acceptance succeeded from a synthetic UA or native Xray.

Rollback may use `profile=compatible` without changing tokens or node services.
For a panel release rollback, follow the standard release backup/health gate.
This change does not require probe publication, server-agent updates, protocol
reinstallation, or changes to the two-region cadence/budget.
