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
const regions = [{ key: 'ap-guangzhou', label: '广州' }, { key: 'ap-chengdu', label: '成都' }, { key: 'ap-beijing', label: '北京' }];
const variants = automaticVariants(node, 'fixture', regions.map((region, i) =>
  ({ region, ips: [`104.16.0.${i + 1}`] })), '104.16.0.4');
const sharedVariants = automaticVariants(node, 'fixture', [
  { region: regions[0], ips: ['104.16.0.1'] }, { region: regions[1], ips: ['104.16.0.1'] },
  { region: regions[2], ips: ['104.16.0.2'] }, { region: { key: 'ap-shanghai', label: '上海' }, ips: ['104.16.0.2'] },
], '104.16.0.4');

function check(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000, env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(result.status, 0, `${binary}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
}
test('worker and panel enforce identical reviewed CF networks', () => assert.deepEqual(CF_RANGES, CF_IP_RANGES));
test('compact automatic groups pass native sing-box checks', { skip: !process.env.REQUIRE_SING_BOX }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-native-'));
  try {
    for (const members of [variants, sharedVariants]) for (const [name, build] of [['singbox', buildFullSingboxConfig], ['homeproxy', buildHomeProxyConfig]]) {
      const file = join(dir, `${name}.json`); writeFileSync(file, build(members)); check('sing-box', ['check', '-c', file]);
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
test('compact provider filters and empty-provider rejection pass native Mihomo parser', { skip: !process.env.MIHOMO_BINARY }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-native-'));
  try {
    const config = buildClashSubscription(variants, 'https://panel.example.com', 'https://panel.example.com/provider');
    const provider = join(dir, 'provider.yaml');
    const groups = config.slice(config.indexOf('proxy-groups:'), config.indexOf('\nrules:'));
    const scoped = `mode: rule\nproxies: []\nproxy-providers:\n  cf-fixture:\n    type: file\n    path: ${JSON.stringify(provider)}\n${groups}\nrules:\n  - MATCH,REJECT\n`;
    const file = join(dir, 'config.yaml'); writeFileSync(file, scoped);
    for (const payload of [variants, sharedVariants].map(members => ['proxies:', ...members.map(buildClashProxy)].join('\n')).concat('proxies: []')) {
      writeFileSync(provider, payload); check(process.env.MIHOMO_BINARY, ['-t', '-d', dir, '-f', file]);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('running Mihomo rejects empty providers for every CF group without COMPATIBLE/DIRECT', { skip: !process.env.MIHOMO_BINARY, timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-native-'));
  let child; let output = ''; let startupError; let latest;
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
    child = spawn(process.env.MIHOMO_BINARY, ['-d', dir, '-f', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-12000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-12000); });
    child.once('error', error => { startupError = error; });
    let result;
    for (let i = 0; i < 60; i++) {
      if (startupError) throw startupError;
      assert.equal(child.exitCode, null, `isolated Mihomo exited before configuration readiness\n${output}`);
      assert.equal(child.signalCode, null, `isolated Mihomo was terminated before configuration readiness\n${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/proxies`, { headers: { Authorization: 'Bearer fixture' }, signal: AbortSignal.timeout(500) });
        if (response.ok) {
          latest = await response.json();
          // The controller can listen before its configured proxy map is installed.
          if (Object.hasOwn(latest.proxies ?? {}, 'fixture [CF fixture]')) { result = latest; break; }
        }
      } catch { /* The isolated controller may still be starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(result, `isolated Mihomo configuration did not load: ${JSON.stringify(latest)}\n${output}`);
    const cfGroups = Object.entries(result.proxies).filter(([name]) => name.startsWith('fixture [CF fixture]'));
    assert.equal(cfGroups.length, 1);
    for (const [, group] of cfGroups) { assert.deepEqual(group.all, ['REJECT']); assert.equal(group.now, 'REJECT'); }
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; }
    rmSync(dir, { recursive: true, force: true });
  }
});
test('running mixed Mihomo keeps ordinary proxies selectable and clears CF HTTP caches without direct fallback', { skip: !process.env.MIHOMO_BINARY, timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-cf-refresh-'));
  let payload = ['proxies:', ...variants.map(buildClashProxy)].join('\n');
  let sourceCalls = 0; let output = ''; let latest;
  const source = http.createServer((_req, res) => { sourceCalls++; res.setHeader('Content-Type', 'text/yaml'); res.end(payload); });
  let child;
  try {
    source.listen(0, '127.0.0.1'); await once(source, 'listening');
    const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
    const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
    const ordinary = { name: 'ordinary fixture', protocol: 'SOCKS5', host: '127.0.0.1', port: 9, tls: 'NONE', credentials: {} };
    const exported = buildClashSubscription([...variants, ordinary], 'https://panel.example.com', 'https://panel.example.com/provider');
    // Frozen pre-compaction filters model clients that only refreshed their provider.
    const legacyRegions = regions.map(region => [
      `  - name: legacy-region-${region.key}`, '    type: select', '    use: [cf-fixture]', '    proxies: [REJECT]',
      `    filter: ${JSON.stringify(`(?:\\[CF-REGION:(${region.key}|GENERIC|DNS)\\] \\[CF:(GENERIC|DNS)\\]|通用候选 [1-3] \\[CF:GENERIC\\]|默认 CDN \\[CF:DNS\\])$`)}`,
    ].join('\n')).join('\n');
    const groups = exported.slice(exported.indexOf('proxy-groups:'), exported.indexOf('\nrules:'))
      .replaceAll('https://www.gstatic.com/generate_204', `http://127.0.0.1:${port}/version`).replaceAll('lazy: false', 'lazy: true')
      + `\n  - name: legacy-carrier-cache\n    type: select\n    use: [cf-fixture]\n    proxies: [REJECT]\n    filter: ${JSON.stringify('\\[CF:(TELECOM|GENERIC|DNS)\\]$')}\n${legacyRegions}\n`;
    const config = `mode: rule\nexternal-controller: 127.0.0.1:${port}\nsecret: fixture\nproxies:\n${buildClashProxy(ordinary)}\nproxy-providers:\n  cf-fixture:\n    type: http\n    url: http://127.0.0.1:${source.address().port}/provider\n    proxy: DIRECT\n    path: ./provider.yaml\n    interval: 900\n    health-check:\n      enable: false\n${groups}\nrules:\n  - MATCH,REJECT\n`;
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
      { region: regions[0], ips: ['104.16.0.1'] }, { ips: ['104.17.0.1'] },
    ], null, regions);
    payload = ['proxies:', ...mixed.map(buildClashProxy)].join('\n');
    assert.ok((await fetch(`http://127.0.0.1:${port}/providers/proxies/cf-fixture`, { method: 'PUT', headers })).ok);
    const partial = await (await fetch(`http://127.0.0.1:${port}/proxies`, { headers })).json();
    assert.ok(partial.proxies['fixture [CF fixture]'].all.includes(mixed[0].name));
    assert.ok(partial.proxies['legacy-region-ap-guangzhou'].all.includes(mixed[0].name));
    assert.ok(partial.proxies['legacy-carrier-cache'].all.includes(mixed[0].name));
    assert.ok(partial.proxies['legacy-carrier-cache'].all.includes(mixed[1].name));
    for (const region of regions.slice(1)) {
      assert.ok(partial.proxies[`legacy-region-${region.key}`].all.includes(mixed[1].name));
      assert.ok(!partial.proxies[`legacy-region-${region.key}`].all.includes(mixed[0].name));
    }
    assert.deepEqual(partial.proxies['🚀 节点选择'].all, ['⚡ 自动选择', 'fixture [CF fixture]', ordinary.name]);
    assert.deepEqual(partial.proxies['⚡ 自动选择'].all, ['fixture [CF fixture]', ordinary.name]);
    const shared = automaticVariants(node, 'fixture', regions.map(region => ({ region, ips: ['104.16.0.1', '104.16.0.2'] })), null);
    assert.equal(shared.length, 1);
    payload = ['proxies:', ...shared.map(buildClashProxy)].join('\n');
    assert.ok((await fetch(`http://127.0.0.1:${port}/providers/proxies/cf-fixture`, { method: 'PUT', headers })).ok);
    const deduplicated = await (await fetch(`http://127.0.0.1:${port}/proxies`, { headers })).json();
    for (const region of regions) assert.ok(deduplicated.proxies[`legacy-region-${region.key}`].all.includes(shared[0].name));
    const legacy = [mixed[1], variants.at(-1)].map(n => ({ ...n, name: n.name.replace(/ \[CF-REGION:(GENERIC|DNS)\]/, '') }));
    payload = ['proxies:', ...legacy.map(buildClashProxy)].join('\n');
    assert.ok((await fetch(`http://127.0.0.1:${port}/providers/proxies/cf-fixture`, { method: 'PUT', headers })).ok);
    const rollback = await (await fetch(`http://127.0.0.1:${port}/proxies`, { headers })).json();
    for (const [name, group] of Object.entries(rollback.proxies).filter(([name]) => name.startsWith('fixture [CF fixture]'))) {
      for (const candidate of legacy) assert.ok(group.all.includes(candidate.name), `${name} must accept safe pre-regional rollback endpoints`);
    }
    for (const region of regions) for (const candidate of legacy) assert.ok(rollback.proxies[`legacy-region-${region.key}`].all.includes(candidate.name));
    payload = buildCfUnavailableProvider('fixture');
    const updated = await fetch(`http://127.0.0.1:${port}/providers/proxies/cf-fixture`, { method: 'PUT', headers });
    assert.ok(updated.ok, `Fail-closed HTTP update rejected: ${await updated.text()}`);
    const result = await (await fetch(`http://127.0.0.1:${port}/proxies`, { headers })).json();
    assert.ok(result.proxies['🚀 节点选择'].all.includes(ordinary.name));
    assert.ok(result.proxies['⚡ 自动选择'].all.includes(ordinary.name));
    assert.deepEqual(result.proxies['legacy-carrier-cache'].all, ['REJECT']);
    const cfGroups = Object.entries(result.proxies).filter(([name]) => name.startsWith('fixture [CF fixture]'));
    assert.equal(cfGroups.length, 1);
    for (const [, group] of cfGroups) { assert.deepEqual(group.all, ['REJECT']); assert.equal(group.now, 'REJECT'); }
    for (const region of regions) assert.deepEqual(result.proxies[`legacy-region-${region.key}`].all, ['REJECT']);
  } finally {
    if (child && child.exitCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; }
    source.closeAllConnections(); await new Promise(resolve => source.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
