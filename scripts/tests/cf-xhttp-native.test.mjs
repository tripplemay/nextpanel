import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { xrayConfig } from '../cf-probe/server.mjs';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'apps/server/package.json'));
require('ts-node').register({ project: join(root, 'apps/server/tsconfig.json'), transpileOnly: true });
const { generateXrayConfig } = require(join(root, 'apps/server/src/nodes/config/xray-config.ts'));
const { cfVariants } = require(join(root, 'apps/server/src/subscriptions/cf-access.util.ts'));
const { buildClashProxy } = require(join(root, 'apps/server/src/subscriptions/uri-builder.ts'));
const xray = process.env.XRAY_BINARY;
const mihomo = process.env.MIHOMO_BINARY;
const credentials = { uuid: '00000000-0000-4000-8000-000000000001', path: '/pilot', xhttpMode: 'packet-up' };

function checked(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, `${binary}: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
async function port() {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const value = socket.address().port; await new Promise(resolve => socket.close(resolve)); return value;
}
async function ready(value, child) {
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, 'fixture process exited before readiness');
    const open = await new Promise(resolve => {
      const socket = net.connect(value, '127.0.0.1');
      socket.setTimeout(100);
      const done = ok => { socket.destroy(); resolve(ok); };
      socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
    });
    if (open) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('fixture readiness timeout');
}
async function request(proxyPort, target, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--silent', '--show-error', '--fail', '--max-time', '10', '--noproxy', '',
      '--proxy', `http://127.0.0.1:${proxyPort}`, '--data-binary', '@-', target], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let error = '';
    child.stdout.on('data', bytes => { out += bytes; }); child.stderr.on('data', bytes => { error += bytes; });
    child.once('error', reject); child.once('close', code => resolve({ code, out, error })); child.stdin.end(payload);
  });
}

test('isolated XHTTP TLS/H2 E2E with Xray worker and Mihomo, including certificate rejection', {
  skip: !xray || !mihomo, timeout: 60000,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'np-xhttp-native-'));
  const children = []; let received = 0; let logs = '';
  const target = http.createServer((req, res) => {
    let bytes = 0; req.on('data', chunk => { bytes += chunk.length; });
    req.on('end', () => { received++; res.end(`fixture:${bytes}`); });
  });
  const start = (binary, args) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
    child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
    child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
    return child;
  };
  try {
    const crt = join(dir, 'fixture.crt'); const key = join(dir, 'fixture.key');
    checked('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=cdn.example.com',
      '-addext', 'subjectAltName=DNS:cdn.example.com', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', key, '-out', crt]);
    target.listen(0, '127.0.0.1'); await once(target, 'listening');
    const targetUrl = `http://127.0.0.1:${target.address().port}/fixture`;
    const listenPort = await port();
    const node = { id: 'fixture', name: 'fixture', protocol: 'VLESS', implementation: 'XRAY', transport: 'XHTTP', tls: 'TLS',
      domain: 'cdn.example.com', listenPort };
    const server = JSON.parse(generateXrayConfig(node, credentials));
    // Only the fixture socket/cert paths change. No public address can be dialed.
    server.inbounds[0].listen = '127.0.0.1';
    server.inbounds[0].streamSettings.tlsSettings.certificates = [{ certificateFile: crt, keyFile: key }];
    server.outbounds.push({ protocol: 'blackhole', tag: 'blocked' });
    server.routing = { rules: [{ type: 'field', ip: ['127.0.0.1'], outboundTag: 'direct' },
      { type: 'field', network: 'tcp,udp', outboundTag: 'blocked' }] };
    const serverFile = join(dir, 'server.json'); writeFileSync(serverFile, JSON.stringify(server));
    checked(xray, ['run', '-test', '-c', serverFile]);
    await ready(listenPort, start(xray, ['run', '-c', serverFile]));

    const clientPort = await port();
    const client = xrayConfig({ domain: node.domain, ...credentials, protocol: 3 }, '127.0.0.1', clientPort);
    client.outbounds[0].settings.vnext[0].port = listenPort;
    client.outbounds[0].streamSettings.tlsSettings.certificates = [{ certificateFile: crt, usage: 'verify' }];
    const clientFile = join(dir, 'worker.json'); writeFileSync(clientFile, JSON.stringify(client));
    checked(xray, ['run', '-test', '-c', clientFile]);
    await ready(clientPort, start(xray, ['run', '-c', clientFile]));
    const upload = 'p'.repeat(128 * 1024);
    const throughWorker = await request(clientPort, targetUrl, upload);
    assert.equal(throughWorker.code, 0, throughWorker.error + logs); assert.equal(throughWorker.out, `fixture:${upload.length}`);

    const candidate = cfVariants({ ...node, host: node.domain, port: 443, credentials }, 'fixture', ['104.16.0.1'], null)[0];
    const cert = readFileSync(crt, 'utf8');
    for (const wrongName of [false, true]) {
      const proxyPort = await port();
      const exported = { ...candidate, host: '127.0.0.1', port: listenPort, domain: wrongName ? 'wrong.example.com' : node.domain };
      // This is the spelling accepted by the pinned Mihomo 1.19.29 native core.
      const yaml = `mixed-port: ${proxyPort}\nbind-address: 127.0.0.1\nallow-lan: false\nmode: rule\ntls:\n  custom-certifactes:\n    - ${JSON.stringify(cert)}\nproxies:\n${buildClashProxy(exported)}\nrules:\n  - ${JSON.stringify(`MATCH,${exported.name}`)}\n`;
      const configFile = join(dir, `mihomo-${wrongName}.yaml`); writeFileSync(configFile, yaml);
      checked(mihomo, ['-t', '-d', dir, '-f', configFile]);
      const before = received;
      await ready(proxyPort, start(mihomo, ['-d', dir, '-f', configFile]));
      const result = await request(proxyPort, targetUrl, upload);
      if (wrongName) { assert.notEqual(result.code, 0); assert.equal(received, before, 'invalid TLS must not reach target'); }
      else { assert.equal(result.code, 0, result.error + logs); assert.equal(result.out, `fixture:${upload.length}`); }
    }
    assert.equal(received, 2);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close'); child.kill('SIGKILL'); await closed;
    }
    target.closeAllConnections(); await new Promise(resolve => target.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
