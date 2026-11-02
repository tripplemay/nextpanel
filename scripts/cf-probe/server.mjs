import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// This is a separate authenticated v2 worker, never a replacement for the legacy GFW function.
export const CF_RANGES = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22',
  '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
const ranges = new net.BlockList();
for (const range of CF_RANGES) {
  const [ip, bits] = range.split('/');
  ranges.addSubnet(ip, +bits, net.isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}
export function isCfIp(ip) {
  const family = typeof ip === 'string' ? net.isIP(ip) : 0;
  if (!family || ip.includes('%') || (family === 6 && new URL(`http://[${ip}]`).hostname.startsWith('[::ffff:'))) return false;
  return ranges.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}
export function validateBatch(body) {
  if (!body || !Array.isArray(body.ips) || !body.ips.length || body.ips.length > 8
    || body.ips.some(ip => !isCfIp(ip)) || new Set(body.ips).size !== body.ips.length
    || typeof body.domain !== 'string' || body.domain.length > 253 || net.isIP(body.domain)
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(body.domain)
    || typeof body.uuid !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.uuid)
    || typeof body.path !== 'string' || !body.path.startsWith('/') || body.path.length > 2048 || /[\r\n\0]/.test(body.path)
    || !Array.isArray(body.downloadIps) || body.downloadIps.length > 3
    || new Set(body.downloadIps).size !== body.downloadIps.length || body.downloadIps.some(ip => !body.ips.includes(ip))
    || Object.keys(body).some(k => !['ips', 'domain', 'uuid', 'path', 'downloadIps', 'protocol', 'transport', 'mode'].includes(k))) throw new Error('INVALID_BATCH');
  if (body.protocol !== undefined || body.transport !== undefined || body.mode !== undefined) {
    if (body.protocol !== 3 || body.transport !== 'XHTTP' || body.mode !== 'packet-up'
      || !/^\/[A-Za-z0-9_/-]{1,128}$/.test(body.path)) throw new Error('INVALID_BATCH');
  }
  return body;
}

export function xrayConfig(body, ip, port) {
  const xhttp = body.protocol === 3;
  return { log: { loglevel: 'none' }, inbounds: [{ listen: '127.0.0.1', port, protocol: 'http', settings: {} }],
    outbounds: [{ protocol: 'vless', settings: { vnext: [{ address: ip, port: 443, users: [{ id: body.uuid, encryption: 'none' }] }] },
      streamSettings: { network: xhttp ? 'xhttp' : 'ws', security: 'tls',
        tlsSettings: { serverName: body.domain, allowInsecure: false, ...(xhttp ? { alpn: ['h2'] } : {}) },
        ...(xhttp ? { xhttpSettings: { path: body.path, host: body.domain, mode: 'packet-up' } }
          : { wsSettings: { path: body.path, headers: { Host: body.domain } } }) } }] };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function ready(port, signal) {
  const deadline = Date.now() + 3000;
  while (!signal.aborted && Date.now() < deadline) {
    const open = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.setTimeout(100);
      const done = ok => { socket.destroy(); resolve(ok); };
      socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
    });
    if (open) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('XRAY_UNAVAILABLE');
}

export function parseCurlMeasurement({ code, tail, bytes, download, exceeded = false }) {
  const match = tail.match(/\nNP_CF_META:(\d{3}) ([\d.]+)\n$/);
  const duration = match ? Number(match[2]) : NaN;
  const payloadBytes = bytes - Buffer.byteLength(match?.[0] ?? '');
  const metadataValid = !!match && Number.isFinite(duration) && duration >= 0;
  if ((code === 0 && !metadataValid) || [2, 4, 48].includes(code)) throw new Error('PROBE_RUNTIME_UNAVAILABLE');
  if (code !== 0 || exceeded || !metadataValid || +match[1] !== (download ? 200 : 204)
    || payloadBytes < 0 || payloadBytes > (download ? 1024 * 1024 : 4096)
    || (download && payloadBytes !== 1024 * 1024)) {
    const error = new Error('END_TO_END_FAILED');
    error.failure = { curlExit: code, httpStatus: match ? +match[1] : null, metadataValid, exceeded };
    throw error;
  }
  return { bytes: payloadBytes, durationMs: Math.max(1, Math.round(duration * 1000)) };
}

async function requestViaProxy(port, download, signal) {
  const maximum = download ? 1024 * 1024 : 4096;
  const target = download ? 'https://speed.cloudflare.com/__down?bytes=1048576' : 'https://www.gstatic.com/generate_204';
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--silent', '--proxy', `http://127.0.0.1:${port}`, '--noproxy', '',
      '--proto', '=https', '--max-time', download ? '10' : '5', '--max-filesize', String(maximum),
      '--write-out', '\nNP_CF_META:%{http_code} %{time_total}\n', target], { stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0; let tail = Buffer.alloc(0); let errorBytes = 0; let exceeded = false;
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    // SCF's curl 7.61.1 lacks %{stderr}; retain only the bounded stdout trailer.
    child.stdout.on('data', chunk => {
      bytes += chunk.length; tail = Buffer.concat([tail, chunk.subarray(-128)]).subarray(-128);
      if (bytes > maximum + 128) { exceeded = true; abort(); }
    });
    child.stderr.on('data', chunk => { errorBytes += chunk.length; if (errorBytes > 4096) abort(); });
    child.once('error', reject);
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      try { resolve(parseCurlMeasurement({ code, tail: tail.toString('ascii'), bytes, download, exceeded })); }
      catch (error) { reject(error); }
    });
  });
}

let runtimeCheckedAt = 0;
const runtimeVersions = {};
async function runtimeAvailable() {
  if (Date.now() - runtimeCheckedAt < 60_000) return true;
  for (const [binary, args] of [[process.env.XRAY_BINARY || 'xray', ['version']], ['curl', ['--version']]]) {
    const ok = await new Promise(resolve => {
      const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, killSignal: 'SIGKILL' });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 8192) child.kill('SIGKILL'); });
      let validVersion = false;
      child.once('close', () => {
        const match = output.match(binary === 'curl' ? /^curl ([\d.]+)/ : /^Xray ([\d.]+)/);
        if (match) {
          runtimeVersions[binary === 'curl' ? 'curl' : 'xray'] = match[1];
          validVersion = binary === 'curl' || match[1] === '26.10.31';
        }
      });
      child.once('error', () => resolve(false)); child.once('close', code => resolve(code === 0 && validVersion));
    });
    if (!ok) return false;
  }
  runtimeCheckedAt = Date.now();
  return true;
}

export async function probeOne(body, ip, outerSignal) {
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(20_000)]);
  const dir = await mkdtemp(join(tmpdir(), 'np-cf-probe-'));
  let child;
  let closed = false;
  try {
    const port = await freePort();
    const config = join(dir, 'config.json');
    await writeFile(config, JSON.stringify(xrayConfig(body, ip, port)), { mode: 0o600 });
    child = spawn(process.env.XRAY_BINARY || 'xray', ['run', '-c', config], { stdio: 'ignore' });
    child.on('error', () => undefined);
    child.once('close', () => { closed = true; });
    await ready(port, signal);
    const test = await requestViaProxy(port, false, signal);
    const result = { ip, ok: true, latency: test.durationMs };
    if (body.downloadIps.includes(ip)) {
      try { Object.assign(result, await requestViaProxy(port, true, signal)); }
      catch { /* A failed throughput sample must not erase a successful connectivity test. */ }
    }
    return result;
  } catch (error) {
    return { ip, ok: false, latency: -1,
      ...(error.failure && { failure: error.failure }),
      ...((['XRAY_UNAVAILABLE', 'PROBE_RUNTIME_UNAVAILABLE'].includes(error.message) || error.code === 'ENOENT') && { error: 'PROBE_RUNTIME_UNAVAILABLE' }) };
  }
  finally {
    if (child?.pid && !closed) {
      await new Promise(resolve => { child.once('close', resolve); child.kill('SIGKILL'); });
    }
    await rm(dir, { recursive: true, force: true });
  }
}

async function egressIp() {
  try {
    const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const reader = response.body.getReader(); let text = ''; let bytes = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        bytes += value.length; if (bytes > 8192) return null; text += Buffer.from(value).toString(); }
    } finally { await reader.cancel(); }
    const ip = text.match(/^ip=(.+)$/m)?.[1];
    return ip && net.isIP(ip) ? ip : null;
  } catch { return null; }
}

export function createProbeServer({ token, id, regionKey = process.env.TENCENTCLOUD_REGION ?? process.env.CF_PROBE_REGION,
  test = probeOne, lookupEgress = egressIp, checkRuntime = runtimeAvailable }) {
  if (typeof token !== 'string' || token.length < 32 || !/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('A strong CF_PROBE_TOKEN and CF_PROBE_ID are required');
  if (regionKey !== undefined && (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(regionKey) || regionKey.length > 40)) throw new Error('Invalid probe region');
  if (process.env.TENCENTCLOUD_REGION && regionKey !== process.env.TENCENTCLOUD_REGION) throw new Error('Probe region conflicts with SCF deployment');
  if (process.env.TENCENTCLOUD_REGION && process.env.CF_PROBE_REGION && process.env.TENCENTCLOUD_REGION !== process.env.CF_PROBE_REGION) throw new Error('Probe region conflicts with SCF deployment');
  let busy = false; let minute = 0; let calls = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const send = (status, body) => { if (!res.destroyed) { res.writeHead(status); res.end(JSON.stringify(body)); } };
    const provided = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${token}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return send(401, { error: 'UNAUTHORIZED' });
    const current = Math.floor(Date.now() / 60_000); if (minute !== current) { minute = current; calls = 0; }
    if (++calls > 30) return send(429, { error: 'RATE_LIMIT' });
    if (!await checkRuntime()) return send(503, { error: 'PROBE_RUNTIME_UNAVAILABLE' });
    if (req.method === 'GET' && req.url === '/capabilities') return send(200, {
      protocol: 2, protocols: [2, 3], probeId: id, egressIp: await lookupEgress(), features: ['vless-ws-tls', 'vless-xhttp-tls-packet-up-h2', 'bounded-download'],
      regionKey: regionKey ?? null, networkType: 'CLOUD', maxCandidates: 8, runtime: { ...runtimeVersions },
    });
    if (req.method !== 'POST' || req.url !== '/probe') return send(404, { error: 'NOT_FOUND' });
    if (busy) return send(429, { error: 'BUSY' });
    busy = true;
    const abort = new AbortController(); const timer = setTimeout(() => { abort.abort(); req.destroy(); }, 85_000);
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const chunks = []; let inputBytes = 0;
      for await (const chunk of req) { inputBytes += chunk.length; if (inputBytes > 16384) throw new Error('INVALID_BATCH'); chunks.push(chunk); }
      const body = validateBatch(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const results = []; let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, body.ips.length) }, async () => {
        for (;;) { const ip = body.ips[cursor++]; if (!ip || abort.signal.aborted) return;
          results.push(await test(body, ip, abort.signal)); }
      }));
      if (results.some(r => r.error)) return send(503, { error: 'PROBE_RUNTIME_UNAVAILABLE' });
      send(200, { protocol: body.protocol ?? 2, ...(body.protocol === 3 ? { transport: 'XHTTP', mode: 'packet-up' } : {}),
        probeId: id, regionKey: regionKey ?? null, networkType: 'CLOUD', egressIp: await lookupEgress(), results });
    } catch { send(400, { error: 'INVALID_OR_ABORTED_BATCH' }); }
    finally { clearTimeout(timer); busy = false; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createProbeServer({ token: process.env.CF_PROBE_TOKEN, id: process.env.CF_PROBE_ID });
  server.requestTimeout = 90_000; server.headersTimeout = 10_000;
  server.listen(Number(process.env.PORT || 9000), '0.0.0.0');
}
