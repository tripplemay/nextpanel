import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'apps/server/package.json'));
require('ts-node').register({ project: join(root, 'apps/server/tsconfig.json'), transpileOnly: true });
const { generateXrayConfig } = require(join(root, 'apps/server/src/nodes/config/xray-config.ts'));
const { usageConfig, runtimeUsers, usageStagingPaths } = require(join(root, 'apps/server/src/usage/usage-config.ts'));
const binary = process.env.XRAY_BINARY;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function port() { const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
function run(command, args) { const r = spawnSync(command, args, { encoding: 'utf8', timeout: 8000 }); assert.equal(r.status, 0, `${r.error ?? ''}\n${r.stdout}\n${r.stderr}`); return r.stdout; }
async function stop(child) { if (child && child.exitCode === null && child.signalCode === null) { const closed = once(child, 'close'); child.kill('SIGTERM'); await closed; } }

test('native Xray identities, hot add/remove, traffic attribution and persistent restart use loopback only', { skip: !binary, timeout: 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-usage-native-'));
  const children = [];
  const sink = http.createServer((_req, res) => res.end('fixture'.repeat(10000)));
  try {
    sink.listen(0, '127.0.0.1'); await once(sink, 'listening');
    const listen = await port(); const api = await port();
    const certificate = join(dir, 'cert.pem'); const key = join(dir, 'key.pem');
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost']);
    const legacy = '00000000-0000-4000-8000-000000000001';
    const first = { email: 'np-usage-one', id: '00000000-0000-4000-8000-000000000002' };
    const second = { email: 'np-usage-two', id: '00000000-0000-4000-8000-000000000003' };
    const config = JSON.parse(generateXrayConfig({ id: 'fixture', protocol: 'VLESS', implementation: 'XRAY', transport: 'WS', tls: 'TLS', domain: 'localhost', listenPort: listen, statsPort: api }, { uuid: legacy }));
    config.inbounds[1].listen = '127.0.0.1';
    config.inbounds[1].streamSettings.tlsSettings.certificates = [{ certificateFile: certificate, keyFile: key }];
    const file = join(dir, 'server.json');
    const prepared = usageConfig(JSON.stringify(config), 'fixture', api, []);
    const staged = usageStagingPaths(file, 'fixture');
    writeFileSync(staged.stage, prepared.config, { mode: 0o600 });
    run(binary, ['run', '-test', '-config', staged.stage]);
    renameSync(staged.stage, file);
    const start = () => { const child = spawn(binary, ['run', '-config', file], { stdio: 'ignore' }); children.push(child); return child; };
    let server = start();
    const address = `--server=127.0.0.1:${api}`;
    for (let i = 0; i < 30; i++) { const r = spawnSync(binary, ['api', 'inbounduser', address, '-tag=in-fixture'], { encoding: 'utf8', timeout: 1000 }); if (r.status === 0) break; await delay(100); }
    const users = () => runtimeUsers(run(binary, ['api', 'inbounduser', address, '-tag=in-fixture']));
    assert.equal(users().get('np-legacy'), legacy);
    const add = staged.additions;
    writeFileSync(add, JSON.stringify({ inbounds: [{ tag: 'in-fixture', listen: '127.0.0.1', port: listen, protocol: 'vless', settings: { decryption: 'none', clients: [first, second].map(u => ({ ...u, level: 4242 })) } }] }));
    const added = run(binary, ['api', 'adu', address, add]);
    assert.equal(users().get(first.email), first.id, `add result: ${added}; users: ${JSON.stringify([...users()])}`);
    assert.equal(users().get(second.email), second.id);
    async function traffic(id) {
      const socks = await port(); const clientFile = join(dir, `client-${id}.json`);
      writeFileSync(clientFile, JSON.stringify({ log: { loglevel: 'none' }, inbounds: [{ listen: '127.0.0.1', port: socks, protocol: 'socks', settings: { auth: 'noauth' } }],
        outbounds: [{ protocol: 'vless', settings: { vnext: [{ address: '127.0.0.1', port: listen, users: [{ id, encryption: 'none' }] }] },
          streamSettings: { network: 'ws', security: 'tls', wsSettings: { path: '/' }, tlsSettings: { serverName: 'localhost', certificates: [{ certificateFile: certificate, usage: 'verify' }] } } }] }));
      const client = spawn(binary, ['run', '-config', clientFile], { stdio: 'ignore' }); children.push(client);
      await delay(400);
      // Async curl allows the in-process HTTP fixture to reply.
      const curl = spawn('curl', ['-fsS', '--max-time', '4', '--proxy', `socks5h://127.0.0.1:${socks}`, '--noproxy', '', `http://127.0.0.1:${sink.address().port}/`, '-o', '/dev/null'], { stdio: 'ignore' });
      assert.equal((await once(curl, 'close'))[0], 0);
      await stop(client);
    }
    await traffic(first.id); await traffic(legacy);
    const counters = JSON.parse(run(binary, ['api', 'statsquery', address, '-pattern=user>>>np-']));
    const values = counters.stat ?? [];
    assert.ok(values.some(s => s.name === `user>>>${first.email}>>>traffic>>>downlink` && Number(s.value) > 0));
    assert.ok(values.some(s => s.name === 'user>>>np-legacy>>>traffic>>>downlink' && Number(s.value) > 0));
    assert.ok(!values.some(s => s.name.includes(second.email) && Number(s.value) > 0));
    if (process.env.GO_BINARY) {
      const go = spawnSync(process.env.GO_BINARY, ['test', '-mod=readonly', '-run', '^TestUsageNativeStats$', '-count=1', '.'], {
        cwd: join(root, 'apps/agent'), env: { ...process.env, USAGE_FIXTURE_STATS_PORT: String(api) }, encoding: 'utf8', timeout: 60000,
      });
      assert.equal(go.status, 0, `Agent native gRPC validation: ${go.stdout}\n${go.stderr}`);
    }
    run(binary, ['api', 'rmu', address, '-tag=in-fixture', second.email]);
    assert.equal(users().has(second.email), false);
    writeFileSync(file, usageConfig(prepared.config, 'fixture', api, [first]).config);
    await stop(server); server = start(); await delay(500);
    assert.equal(users().get(first.email), first.id, 'ready credential survives process restart');
    assert.equal(users().has(second.email), false);
    await traffic(first.id);
  } finally {
    for (const child of children) await stop(child);
    sink.closeAllConnections(); await new Promise(r => sink.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
