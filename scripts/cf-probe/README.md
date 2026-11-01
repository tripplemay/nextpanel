# Isolated CF probe (WS v2 / XHTTP v3)

This HTTP worker is **not** a replacement for `gfw-check/index.handler`.
The original TCP-only function remains unchanged. See
[`RUNBOOK-cf-auto.md`](../../docs/RUNBOOK-cf-auto.md) for rollout and rollback.

## Runtime / packaging

- Node.js 22+, curl, and reviewed Xray-core **26.2.6**. Other/missing Xray versions
  fail runtime readiness rather than silently claiming transport support.
- The worker starts on `0.0.0.0:9000`; a trusted HTTPS gateway must front it.
- `CF_PROBE_ID`: stable lowercase ID, e.g. `guangzhou-cloud`.
- Region identity comes from SCF's built-in `TENCENTCLOUD_REGION` (e.g.
  `ap-chengdu`). Outside SCF set `CF_PROBE_REGION`. Conflicting values stop startup.
  This is the cloud deployment region, not a residential ISP or Cloudflare POP.
- `CF_PROBE_TOKEN`: independently generated random bearer secret, at least 32
  characters. Inject through the deployment secret store, never the image/Git.
- `XRAY_BINARY`: optional absolute binary path; defaults to `xray` on PATH.
- No database, SSH credentials, Cloudflare API token or account role is needed.

For a reproducible release, obtain the **Linux target-architecture** Xray binary
from the official XTLS/Xray-core release, verify its published checksums and place
it at `vendor/xray`. Record its version/hash plus the base/image digest in private
release evidence. The Docker build requires the reviewed binary hash:

```sh
docker build --platform linux/amd64 \
  --build-arg XRAY_SHA256="$REVIEWED_XRAY_SHA256" \
  -t nextpanel-cf-probe:RELEASE scripts/cf-probe
```

The template base tag must be resolved/pinned to a tested digest for deployment.
Do not copy a macOS binary into the Linux image. The source tree deliberately
does not contain third-party executables. Building/pushing/deploying an image is
a separate release operation, not performed by tests.

For Tencent SCF, create a **separate Web function / WebServer image** in the
existing account/region, not an event function using `index.handler`. The official
[image contract](https://intl.cloud.tencent.com/zh/document/product/583/41076)
uses port 9000 and forwards Web request paths. Confirm the selected URL preserves
`/capabilities` and `/probe` and forwards `Authorization`. Start with 512 MB,
120-second execution timeout, concurrency/instance ceiling 1, HTTPS-only URL,
no permissive CORS, no request-body/header logging and no unnecessary cloud role.
These resource values are proposed pilot settings, not measured capacity.

## Native SCF Node.js 22.21 ZIP alternative

The Guangzhou console also offers Node.js 22.21 for Web functions. This avoids
creating a separate container registry. Package the pinned official Xray Linux
amd64 archive with `node scripts/cf-probe/package-scf.mjs Xray-linux-64.zip OUTPUT.zip`.
The packager verifies the archive digest and ELF architecture, includes only the
worker, executable bootstrap and Xray, and emits a checksum manifest. The ZIP
contains no token. Select Web function / Node.js 22.21, upload it and set startup
command `bash /var/user/scf_bootstrap`, port 9000 and the same bounded resources.
The runtime must supply curl; verify authenticated capabilities and actual E2E
before enabling the scheduler. A missing native runtime fails closed with 503.
The new credential must be entered securely in the console, not added to the ZIP.
The verified native runtime supplies curl 7.61.1, which lacks `%{stderr}`
write-out support. The worker uses a bounded stdout trailer instead; trailer
bytes are excluded from download accounting. Invalid runtime metadata fails the
batch as infrastructure failure, not as a bad CF IP. Authenticated capabilities
include sanitized runtime version numbers, and failed measurements expose only
numeric curl/HTTP diagnostics, never stderr or proxy credentials.

## Protocol

Both endpoints require `Authorization: Bearer <secret>` and return `no-store`.

- `GET /capabilities`: protocol 2, `protocols: [2,3]`, probe ID, current outbound IP, `regionKey`,
  `networkType=CLOUD` and supported features. Missing Xray/curl returns 503.
  Missing region returns null for legacy generic compatibility, never a guessed city.
- `POST /probe`: `{ips, domain, uuid, path, downloadIps}`. At most eight literal
  CF addresses, fixed port 443, at most three downloads. No arbitrary test URL,
  command, upstream proxy, port or Xray configuration is accepted.
- XHTTP adds exactly `protocol: 3, transport: 'XHTTP', mode: 'packet-up'` to that
  request. Capabilities must include `vless-xhttp-tls-packet-up-h2`; results echo
  protocol, transport and mode. Legacy WS payloads and v2 responses are unchanged.
  See [CDN XHTTP release gates](../../docs/RUNBOOK-cf-xhttp.md).
- Results repeat the regional identity and contain IP, success and E2E latency; successful download samples add
  byte count/duration. Errors and logs never include UUID/path/authorization.

For each candidate, Xray dials its literal CF IP while retaining domain SNI and
WS/XHTTP Host, certificate verification, UUID and transport path. XHTTP pins
`packet-up` and H2 with no alternate download endpoint. curl is explicitly forced
through that loopback proxy (`--noproxy ''`); there is no direct retry. Connectivity
uses a fixed HTTPS 204 endpoint. The optional throughput sample uses a fixed
1 MiB Cloudflare download URL. Only a complete 200 response counts as a sample.
Function cold start/Xray startup are excluded from curl's measured duration.

Bounds: one batch at a time, four candidate workers, 20 seconds per candidate,
85 seconds per batch, 16 KiB request body, 30 authenticated calls/minute/instance.
Temporary credential files are mode 0600 and removed with child processes after
each test. A worker startup failure returns an infrastructure error for the
batch, not a verdict that every candidate IP is down. Durable daily download
and candidate-request quotas are enforced by the panel; these are not total
network-byte or cloud-billing caps. Instance limits must also be set in SCF.

The approved next rollout is Guangzhou + Chengdu, 15-minute panel cadence,
25,000 global batches/month and CNY 30/month. See
[`CF-PROBE-BUDGET.md`](../../docs/CF-PROBE-BUDGET.md) for a settled-bill projection
and required cloud-side checks. `node scripts/cf-probe/estimate-cost.mjs` only
calculates scenarios locally; it never invokes, purchases or deploys a function.

Local tests use only loopback/stubs and optional native config parsers:

```sh
node --test scripts/tests/cf-probe.test.mjs
REQUIRE_SING_BOX=1 XRAY_BINARY=/path/to/xray MIHOMO_BINARY=/path/to/mihomo \
  node --test scripts/tests/cf-auto-native.test.mjs
```
