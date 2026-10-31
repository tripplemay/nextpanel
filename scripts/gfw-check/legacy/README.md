# Recovered legacy TCP-check function

Read-only source recovery from the authenticated Tencent Cloud console on
2026-10-31. `index.cjs` is the deployed `index.js` with whitespace normalized and
an archive header added; do not treat it as a byte-identical downloaded ZIP.
No cloud code edit, console Test action, deployment or configuration save was made.
The user authorized switching to the old editor after the new editor stalled.

Verified console configuration:

- Name `gfw-check`, region `ap-guangzhou`, namespace `default`, `$LATEST`.
- Event function, Nodejs 18.15, handler `index.handler`.
- Created 2026-03-08 02:10:23; modified 2026-03-08 03:44:14 (console local times).
- Memory 128 MB, execution timeout 15 s, initialization timeout 65 s.
- Public outbound network enabled, no VPC/subnet, no execution role, no persistent
  log configuration. No carrier-specific/fixed-egress evidence was established.

The cloud download API reported CodeSha256
`e4de80265a39bbceb3dbb1cf5fcaa25607513b49709715d4c511c11550e0e3db`.
The browser download did not yield a local ZIP; that hash is cloud-reported, not
independently recomputed. Signed download/editor URLs are deliberately omitted.

Project linkage: commit `76d66a81b47415ead98a666f9baa6e76369c272e` introduced the
caller on March 8. `apps/server/src/ip-check/gfw-check.service.ts` POSTs `{ip,port}`
to `GFW_CHECK_FUNCTION_URL`, consumes `reachable/latency` and times out at 15 s.
`ip-check.service.ts` currently passes the server SSH port, not the proxy port.
The original cloud function implementation was not found in tracked Git history;
this archive closes that reproducibility gap.

The function only runs `net.Socket.connect`; default port 443 / socket timeout
5000 ms. It does not perform TLS verification, WS handshake, VLESS authentication,
HTTP end-to-end checks, throughput measurement or carrier identification. No
application-level authentication/input bounds appear in this source. The cloud
trigger access policy was not comprehensively audited here. Do not repurpose or
expand its public input surface for preferred-IP probing.

An earlier read-only GET returned HTTP 430; the normal caller uses POST. That GET
is not evidence that the current scheduled detection is broken. No synthetic
public probe was used to claim legacy production acceptance.
