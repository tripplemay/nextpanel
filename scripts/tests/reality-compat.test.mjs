import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import http from 'node:http';
import http2 from 'node:http2';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'apps/server/package.json'));
require('ts-node').register({ project: join(root, 'apps/server/tsconfig.json'), transpileOnly: true });
const { generateChainExitConfig } = require(join(root, 'apps/server/src/nodes/config/config-generator.ts'));
const { generateSingBoxConfig } = require(join(root, 'apps/server/src/nodes/config/singbox-config.ts'));
const xray = process.env.REALITY_XRAY_BINARY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function port() {
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const p = socket.address().port; await new Promise(r => socket.close(r)); return p;
}
async function ready(p, child) {
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, 'Fixture process exited');
    const up = await new Promise(r => {
      const socket = net.connect(p, '127.0.0.1'); socket.setTimeout(100);
      const end = value => { socket.destroy(); r(value); };
      socket.once('connect', () => end(true)); socket.once('error', () => end(false)); socket.once('timeout', () => end(false));
    });
    if (up) return;
    await sleep(50);
  }
  throw Error('Fixture readiness timeout');
}
async function request(p, url) {
  const child = spawn('curl', ['-fsS', '--max-time', '5', '--noproxy', '', '--proxy', `http://127.0.0.1:${p}`, url]);
  let body = ''; child.stdout.on('data', c => { body += c; }); child.stderr.resume();
  const [code] = await once(child, 'close'); return { code, body };
}

test('compatible REALITY core accepts sing-box and rejects invalid authentication', { skip: !xray, timeout: 40000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'np-reality-compat-'));
  const children = [], sockets = new Set(); let logs = '', received = 0;
  const sink = http.createServer((_req, res) => { received++; res.end('fixture-ok'); });
  let decoy;
  const start = (binary, file) => {
    const child = spawn(binary, ['run', '-c', file], { env: { ...process.env, GODEBUG: 'multipathtcp=0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', c => { logs = (logs + c).slice(-12000); });
    return child;
  };
  const configFile = (name, config) => {
    const file = join(directory, name + '.json'); writeFileSync(file, JSON.stringify(config), { mode: 0o600 }); return file;
  };
  try {
    const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
    const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fixture.example',
      '-addext', 'subjectAltName=DNS:fixture.example', '-keyout', key, '-out', cert], { encoding: 'utf8', timeout: 10000 });
    assert.equal(certificate.status, 0, certificate.stderr);
    sink.listen(0, '127.0.0.1'); await once(sink, 'listening');
    decoy = http2.createSecureServer({ key: readFileSync(key), cert: readFileSync(cert), minVersion: 'TLSv1.3', allowHTTP1: true });
    decoy.on('sessionError', () => {}); decoy.on('tlsClientError', () => {});
    decoy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    decoy.on('request', (_req, res) => res.end('decoy'));
    decoy.listen(0, '127.0.0.1'); await once(decoy, 'listening');
    const keys = generateKeyPairSync('x25519');
    const privateKey = keys.privateKey.export({ format: 'jwk' }).d;
    const publicKey = keys.publicKey.export({ format: 'jwk' }).x;
    const uuid = '00000000-0000-4000-8000-000000000001', shortId = '0123456789abcdef';
    const exitPort = await port();
    const server = JSON.parse(generateChainExitConfig('fixture', exitPort, uuid, '127.0.0.1', { privateKey, shortId }));
    server.inbounds[0].listen = '127.0.0.1';
    server.inbounds[0].streamSettings.realitySettings.target = `127.0.0.1:${decoy.address().port}`;
    server.inbounds[0].streamSettings.realitySettings.serverNames = ['fixture.example'];
    // Restrict the source-allow rule to the fixture sink as well.
    Object.assign(server.routing.rules[0], { ip: ['127.0.0.1/32'], port: String(sink.address().port) });
    await ready(exitPort, start(xray, configFile('exit', server)));
    for (const valid of [true, false]) {
      const p = await port();
      const client = JSON.parse(generateSingBoxConfig({ id: 'fixture', protocol: 'ANYTLS', tls: 'TLS', listenPort: p,
        chainExitIp: '127.0.0.1', chainExitPort: exitPort, chainUuid: uuid,
        chainRealityPrivateKey: privateKey, chainRealityPublicKey: publicKey, chainShortId: valid ? shortId : 'fedcba9876543210' }, {}));
      client.inbounds = [{ type: 'mixed', tag: 'in-fixture', listen: '127.0.0.1', listen_port: p }];
      client.outbounds[0].tls.server_name = 'fixture.example';
      await ready(p, start(process.env.SING_BOX_BINARY || 'sing-box', configFile(valid ? 'valid' : 'invalid', client)));
      const result = await request(p, `http://127.0.0.1:${sink.address().port}/`);
      if (valid) { assert.equal(result.code, 0, logs); assert.equal(result.body, 'fixture-ok'); }
      else assert.notEqual(result.code, 0, 'Invalid REALITY short ID must never reach the sink');
    }
    assert.equal(received, 1);
  } finally {
    for (const child of children) child.kill('SIGKILL');
    await Promise.all(children.map(child => child.exitCode === null ? once(child, 'close') : Promise.resolve()));
    for (const socket of sockets) socket.destroy();
    sink.closeAllConnections(); sink.close(); decoy?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
