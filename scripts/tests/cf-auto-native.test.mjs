import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { xrayConfig, CF_RANGES } from '../cf-probe/server.mjs';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'apps/server/package.json'));
require('ts-node').register({ project: join(root, 'apps/server/tsconfig.json'), transpileOnly: true });
const { automaticVariants } = require(join(root, 'apps/server/src/subscriptions/cf-optimization.util.ts'));
const { CF_IP_RANGES } = require(join(root, 'apps/server/src/subscriptions/cf-access.util.ts'));
const { buildClashSubscription, buildClashProxy, buildFullSingboxConfig, buildHomeProxyConfig, buildCfUnavailableProvider } = require(join(root, 'apps/server/src/subscriptions/uri-builder.ts'));
const node = { name: 'fixture', host: 'cdn.example.com', port: 443, domain: 'cdn.example.com',
  protocol: 'VLESS', tls: 'TLS', transport: 'WS', credentials: { uuid: '00000000-0000-4000-8000-000000000001', path: '/ws' } };
const variants = automaticVariants(node, 'fixture', ['TELECOM', 'UNICOM', 'MOBILE'].map((carrier, i) =>
  ({ carrier, ips: [`104.16.0.${i + 1}`] })), '104.16.0.4');

function check(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000, env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(result.status, 0, `${binary}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}
test('worker and panel enforce identical reviewed CF networks', () => assert.deepEqual(CF_RANGES, CF_IP_RANGES));
test('automatic carrier groups pass native sing-box checks', { skip: !process.env.REQUIRE_SING_BOX }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-native-'));
  try {
    for (const [name, build] of [['singbox', buildFullSingboxConfig], ['homeproxy', buildHomeProxyConfig]]) {
      const file = join(dir, `${name}.json`); writeFileSync(file, build(variants)); check('sing-box', ['check', '-c', file]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('v2 worker config passes native Xray syntax check without opening a proxy', { skip: !process.env.XRAY_BINARY }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-native-'));
  try {
    const file = join(dir, 'xray.json');
    writeFileSync(file, JSON.stringify(xrayConfig({ domain: node.domain, ...node.credentials }, '104.16.0.1', 1080)));
    check(process.env.XRAY_BINARY, ['run', '-test', '-c', file]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('dynamic carrier provider filters and empty-provider rejection pass native Mihomo parser', { skip: !process.env.MIHOMO_BINARY }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-native-'));
  try {
    const config = buildClashSubscription(variants, 'https://panel.example.com', 'https://panel.example.com/provider');
    const provider = join(dir, 'provider.yaml');
    const groups = config.slice(config.indexOf('proxy-groups:'), config.indexOf('\nrules:'));
    const scoped = `mode: rule\nproxies: []\nproxy-providers:\n  cf-fixture:\n    type: file\n    path: ${JSON.stringify(provider)}\n${groups}\nrules:\n  - MATCH,REJECT\n`;
    const file = join(dir, 'config.yaml'); writeFileSync(file, scoped);
    for (const payload of [['proxies:', ...variants.map(buildClashProxy)].join('\n'), 'proxies: []']) {
      writeFileSync(provider, payload); check(process.env.MIHOMO_BINARY, ['-t', '-d', dir, '-f', file]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('running Mihomo rejects empty providers for every CF group without COMPATIBLE/DIRECT', { skip: !process.env.MIHOMO_BINARY, timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-native-'));
  let child;
  try {
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const provider = join(dir, 'provider.yaml'); writeFileSync(provider, 'proxies: []');
    const exported = buildClashSubscription(variants, 'https://panel.example.com', 'https://panel.example.com/provider');
    // Use only loopback health URLs; never dial the fixture's public CF IPs.
    const groups = exported.slice(exported.indexOf('proxy-groups:'), exported.indexOf('\nrules:'))
      .replaceAll('https://www.gstatic.com/generate_204', `http://127.0.0.1:${port}/version`).replaceAll('lazy: false', 'lazy: true');
    const config = `mode: rule\nexternal-controller: 127.0.0.1:${port}\nsecret: fixture\nproxies: []\nproxy-providers:\n  cf-fixture:\n    type: file\n    path: ${JSON.stringify(provider)}\n${groups}\nrules:\n  - MATCH,REJECT\n`;
    const file = join(dir, 'config.yaml'); writeFileSync(file, config);
    child = spawn(process.env.MIHOMO_BINARY, ['-d', dir, '-f', file], { stdio: 'ignore' });
    let result;
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/proxies`, { headers: { Authorization: 'Bearer fixture' }, signal: AbortSignal.timeout(500) });
        if (response.ok) { result = await response.json(); break; }
      } catch { /* The isolated controller may still be starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(result, 'isolated Mihomo controller did not start');
    const cfGroups = Object.entries(result.proxies).filter(([name]) => name.startsWith('fixture [CF fixture]'));
    assert.equal(cfGroups.length, 4);
    for (const [, group] of cfGroups) { assert.deepEqual(group.all, ['REJECT']); assert.equal(group.now, 'REJECT'); }
  } finally {
    if (child && child.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; }
    rmSync(dir, { recursive: true, force: true });
  }
});
test('running Mihomo clears populated HTTP providers with a fail-closed sentinel', { skip: !process.env.MIHOMO_BINARY, timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-refresh-'));
  let payload = ['proxies:', ...variants.map(buildClashProxy)].join('\n');
  let sourceCalls = 0; let output = ''; let latest;
  const source = http.createServer((_req, res) => { sourceCalls++; res.setHeader('Content-Type', 'text/yaml'); res.end(payload); });
  let child;
  try {
    source.listen(0, '127.0.0.1'); await once(source, 'listening');
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const exported = buildClashSubscription(variants, 'https://panel.example.com', 'https://panel.example.com/provider');
    const groups = exported.slice(exported.indexOf('proxy-groups:'), exported.indexOf('\nrules:'))
      .replaceAll('https://www.gstatic.com/generate_204', `http://127.0.0.1:${port}/version`).replaceAll('lazy: false', 'lazy: true');
    const config = `mode: rule\nexternal-controller: 127.0.0.1:${port}\nsecret: fixture\nproxies: []\nproxy-providers:\n  cf-fixture:\n    type: http\n    url: http://127.0.0.1:${source.address().port}/provider\n    proxy: DIRECT\n    path: ./provider.yaml\n    interval: 900\n    health-check:\n      enable: false\n${groups}\nrules:\n  - MATCH,REJECT\n`;
    const file = join(dir, 'config.yaml'); writeFileSync(file, config);
    child = spawn(process.env.MIHOMO_BINARY, ['-d', dir, '-f', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-12000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-12000); });
    const headers = { Authorization: 'Bearer fixture' };
    let populated = false;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/providers/proxies/cf-fixture`, { headers, signal: AbortSignal.timeout(500) });
        latest = await r.json();
        if (r.ok && latest.proxies.length === variants.length) { populated = true; break; }
      } catch { /* Wait only for this isolated controller's observable startup. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(populated, `HTTP provider did not load its initial endpoints: calls=${sourceCalls} response=${JSON.stringify(latest)}\n${output}`);
    const mixed = automaticVariants(node, 'fixture', [
      { carrier: 'TELECOM', ips: ['104.16.0.1'] }, { carrier: 'GENERIC', ips: ['104.17.0.1'] },
    ], null);
    payload = ['proxies:', ...mixed.map(buildClashProxy)].join('\n');
    assert.ok((await fetch(`http://127.0.0.1:${port}/providers/proxies/cf-fixture`, { method: 'PUT', headers })).ok);
    const partial = await (await fetch(`http://127.0.0.1:${port}/proxies`, { headers })).json();
    for (const label of ['联通优选', '移动优选']) {
      assert.ok(partial.proxies[`fixture [CF fixture] ${label}`].all.includes(mixed[1].name));
      assert.ok(!partial.proxies[`fixture [CF fixture] ${label}`].all.includes(mixed[0].name));
    }
    payload = buildCfUnavailableProvider('fixture');
    const updated = await fetch(`http://127.0.0.1:${port}/providers/proxies/cf-fixture`, { method: 'PUT', headers });
    assert.ok(updated.ok, `Fail-closed HTTP update rejected: ${await updated.text()}`);
    const result = await (await fetch(`http://127.0.0.1:${port}/proxies`, { headers })).json();
    const cfGroups = Object.entries(result.proxies).filter(([name]) => name.startsWith('fixture [CF fixture]'));
    assert.equal(cfGroups.length, 4);
    for (const [, group] of cfGroups) { assert.deepEqual(group.all, ['REJECT']); assert.equal(group.now, 'REJECT'); }
  } finally {
    if (child && child.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; }
    source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
