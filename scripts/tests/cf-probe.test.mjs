import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createProbeServer, validateBatch, xrayConfig, isCfIp, probeOne, parseCurlMeasurement, waitForXrayReady } from '../cf-probe/server.mjs';

test('parses portable curl trailers without counting metadata as payload', () => {
  const trailer = '\nNP_CF_META:204 1.250000\n';
  assert.deepEqual(parseCurlMeasurement({ code: 0, tail: trailer, bytes: trailer.length, download: false }), { bytes: 0, durationMs: 1250 });
  const download = '\nNP_CF_META:200 2.500000\n';
  const result = { code: 0, tail: 'payload-tail' + download, bytes: 1024 * 1024 + download.length, download: true };
  assert.deepEqual(parseCurlMeasurement(result), { bytes: 1024 * 1024, durationMs: 2500 });
  for (const change of [{ bytes: result.bytes - 1 }, { bytes: result.bytes + 1 }, { code: 28 }, { exceeded: true }, { tail: '\nNP_CF_META:500 1.0\n' }]) {
    assert.throws(() => parseCurlMeasurement({ ...result, ...change }), /END_TO_END_FAILED/);
  }
  for (const change of [{ tail: 'unsupported write-out' }, { tail: '\nNP_CF_META:200 ...\n' }, { code: 2 }]) {
    assert.throws(() => parseCurlMeasurement({ ...result, ...change }), /PROBE_RUNTIME_UNAVAILABLE/);
  }
});

const batch = { ips: ['104.16.0.1'], downloadIps: [], domain: 'cdn.example.com',
  uuid: '00000000-0000-4000-8000-000000000001', path: '/ws' };
test('probe validates bounded CF-only targets and rejects arbitrary proxy configuration', () => {
  assert.equal(validateBatch(batch), batch);
  for (const ip of ['127.0.0.1', '::1', '::ffff:104.16.0.1', '192.0.2.1', '169.254.169.254']) {
    assert.equal(isCfIp(ip), false); assert.throws(() => validateBatch({ ...batch, ips: [ip] }));
  }
  for (const change of [{ ips: Array(9).fill('104.16.0.1') }, { domain: '127.0.0.1' }, { path: '/\r\nHost: internal' },
    { downloadIps: ['104.16.0.2'] }, { url: 'http://internal/' }, { port: 22 }, { config: {} }]) {
    assert.throws(() => validateBatch({ ...batch, ...change }));
  }
  const config = xrayConfig(batch, batch.ips[0], 1080);
  assert.equal(config.inbounds[0].listen, '127.0.0.1');
  assert.equal(config.outbounds[0].streamSettings.tlsSettings.allowInsecure, false);
  assert.equal(config.outbounds[0].streamSettings.wsSettings.headers.Host, batch.domain);
  assert.equal(config.outbounds[0].settings.vnext[0].address, batch.ips[0]);
});
test('missing runtime is infrastructure failure, never an IP reachability verdict', async t => {
  const server = createProbeServer({ token: 'f'.repeat(32), id: 'fixture', checkRuntime: async () => false });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/capabilities`, { headers: { Authorization: `Bearer ${'f'.repeat(32)}` } });
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'PROBE_RUNTIME_UNAVAILABLE');
});
test('missing Xray process cleans up and terminates within the bounded startup deadline', { timeout: 7000 }, async () => {
  const old = process.env.XRAY_BINARY;
  try {
    process.env.XRAY_BINARY = '/nonexistent/nextpanel-fixture-xray';
    const result = await probeOne(batch, batch.ips[0], new AbortController().signal);
    assert.equal(result.error, 'PROBE_RUNTIME_UNAVAILABLE');
  } finally { if (old === undefined) delete process.env.XRAY_BINARY; else process.env.XRAY_BINARY = old; }
});
test('a recycled listening port cannot mask a missing Xray executable', { timeout: 3000 }, async t => {
  const listener = net.createServer(socket => socket.destroy());
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  t.after(() => listener.close());
  const child = spawn('/nonexistent/nextpanel-fixture-xray', [], { stdio: 'ignore' });
  await assert.rejects(waitForXrayReady(child, listener.address().port, new AbortController().signal), /XRAY_UNAVAILABLE/);
  for (const event of ['error', 'exit', 'close']) assert.equal(child.listenerCount(event), 0);
});
test('Xray readiness rejects exited processes and exit during connection polling', { timeout: 3000 }, async t => {
  const listener = net.createServer(socket => socket.destroy());
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  t.after(() => listener.close());
  for (const event of ['exit', 'close', 'error']) {
    const child = new EventEmitter();
    child.exitCode = null; child.signalCode = null;
    const pending = waitForXrayReady(child, listener.address().port, new AbortController().signal);
    child.emit(event, event === 'error' ? new Error('fixture failure') : 0);
    await assert.rejects(pending, /XRAY_UNAVAILABLE/);
    for (const name of ['error', 'exit', 'close']) assert.equal(child.listenerCount(name), 0);
  }
  const exited = new EventEmitter(); exited.exitCode = 0;
  await assert.rejects(waitForXrayReady(exited, listener.address().port, new AbortController().signal), /XRAY_UNAVAILABLE/);
});
test('probe authentication, identity and exact-target HTTP contract without external IO', async t => {
  let calls = 0;
  const token = 'f'.repeat(32);
  const server = createProbeServer({ token, id: 'fixture', regionKey: 'ap-chengdu', lookupEgress: async () => '192.0.2.1', checkRuntime: async () => true,
    test: async (_body, ip) => { calls++; return { ip, ok: true, latency: 50 }; } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/capabilities')).status, 401);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const capabilities = await (await fetch(url + '/capabilities', { headers })).json();
  assert.equal(capabilities.regionKey, 'ap-chengdu'); assert.equal(capabilities.networkType, 'CLOUD'); assert.equal(capabilities.probeId, 'fixture');
  assert.equal(capabilities.carrier, undefined);
  const response = await fetch(url + '/probe', { method: 'POST', headers, body: JSON.stringify(batch) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.regionKey, capabilities.regionKey);
  assert.deepEqual(result.results, [{ ip: batch.ips[0], ok: true, latency: 50 }]);
  assert.equal((await fetch(url + '/probe', { method: 'POST', headers, body: JSON.stringify({ ...batch, ips: ['127.0.0.1'] }) })).status, 400);
  assert.equal(calls, 1);
});
test('SCF deployment region takes precedence and conflicts fail closed', async t => {
  const old = { ...process.env };
  t.after(() => { process.env = old; });
  process.env.TENCENTCLOUD_REGION = 'ap-chengdu';
  delete process.env.CF_PROBE_REGION;
  const server = createProbeServer({ token: 'f'.repeat(32), id: 'fixture', lookupEgress: async () => null, checkRuntime: async () => true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await (await fetch(`http://127.0.0.1:${server.address().port}/capabilities`, { headers: { Authorization: `Bearer ${'f'.repeat(32)}` } })).json();
  assert.equal(result.regionKey, 'ap-chengdu');
  process.env.CF_PROBE_REGION = 'ap-guangzhou';
  assert.throws(() => createProbeServer({ token: 'f'.repeat(32), id: 'fixture' }), /conflicts/);
});

test('XHTTP v3 is explicit, bounded and cannot supply alternate download settings', () => {
  const request = { ...batch, protocol: 3, transport: 'XHTTP', mode: 'packet-up', path: '/pilot' };
  assert.equal(validateBatch(request), request);
  for (const override of [{ protocol: 2 }, { transport: 'WS' }, { mode: 'auto' }, { extra: {} },
    { downloadSettings: { address: '127.0.0.1' } }, { path: '/' }, { path: '/?q=1' }]) {
    assert.throws(() => validateBatch({ ...request, ...override }), /INVALID_BATCH/);
  }
  assert.throws(() => validateBatch({ ...batch, transport: 'XHTTP' }), /INVALID_BATCH/);
  const outbound = xrayConfig(request, request.ips[0], 1080).outbounds[0];
  assert.equal(outbound.settings.vnext[0].address, request.ips[0]);
  assert.deepEqual(outbound.streamSettings, { network: 'xhttp', security: 'tls',
    tlsSettings: { serverName: batch.domain, allowInsecure: false, alpn: ['h2'] },
    xhttpSettings: { path: '/pilot', host: batch.domain, mode: 'packet-up' } });
});

test('dual probe contract preserves v2 WS and echoes v3 transport identity', async t => {
  const server = createProbeServer({ token: 'f'.repeat(32), id: 'dual', regionKey: 'ap-guangzhou',
    lookupEgress: async () => null, checkRuntime: async () => true,
    test: async (_body, ip) => ({ ip, ok: true, latency: 1 }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${'f'.repeat(32)}`, 'Content-Type': 'application/json' };
  const caps = await (await fetch(url + '/capabilities', { headers })).json();
  assert.equal(caps.protocol, 2); assert.deepEqual(caps.protocols, [2, 3, 4]);
  assert.ok(caps.features.includes('vless-xhttp-tls-packet-up-h2'));
  for (const body of [batch, { ...batch, protocol: 3, transport: 'XHTTP', mode: 'packet-up' },
    { ...batch, protocol: 4, transport: 'XHTTP', mode: 'stream-up', alpn: 'h2' },
    { ...batch, protocol: 4, transport: 'XHTTP', mode: 'packet-up', alpn: 'h3' }]) {
    const response = await fetch(url + '/probe', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.protocol, body.protocol ?? 2); assert.equal(result.transport, body.transport);
    assert.equal(result.mode, body.mode); assert.equal(result.regionKey, 'ap-guangzhou');
    assert.equal(result.alpn, body.alpn);
  }
});

test('v4 profiles require exact ALPN/mode and preserve TLS verification and CDN restrictions', () => {
  for (const [alpn, mode] of [['h2', 'stream-up'], ['h3', 'packet-up']]) {
    const request = { ...batch, protocol: 4, transport: 'XHTTP', mode, alpn, path: '/pilot' };
    validateBatch(request);
    const outbound = xrayConfig(request, request.ips[0], 1080).outbounds[0];
    assert.deepEqual(outbound.streamSettings.tlsSettings, { serverName: batch.domain, allowInsecure: false, alpn: [alpn] });
    assert.equal(outbound.streamSettings.xhttpSettings.mode, mode);
    for (const override of [{ protocol: 3 }, { alpn: ['h3'] }, { alpn: 'http/1.1' }, { mode: 'auto' },
      { mode: 'stream-one' }, { ips: ['192.0.2.1'] }, { downloadSettings: { address: '192.0.2.1' } }]) {
      assert.throws(() => validateBatch({ ...request, ...override }), /INVALID_BATCH/);
    }
  }
  assert.throws(() => validateBatch({ ...batch, protocol: 4, transport: 'XHTTP', mode: 'stream-up', alpn: 'h3' }), /INVALID_BATCH/);
});
