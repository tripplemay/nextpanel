// Run as root on Linux. All firewall/listener changes occur in a private network
// and mount namespace; the parent never modifies host networking or /etc.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync, execFile, spawnSync } = require('node:child_process');
const http = require('node:http');
const { promisify } = require('node:util');
const run = promisify(execFile);
assert.equal(process.platform, 'linux', 'Linux kernel acceptance required');
assert.equal(process.getuid(), 0, 'Run with sudo in the disposable CI runner');
if (process.argv[2] !== 'isolated') {
  const child = spawnSync('unshare', ['--net', '--mount', '--fork', process.execPath, __filename, 'isolated'], {
    stdio: 'inherit', env: { ...process.env, NP_PARENT_NETNS: fs.readlinkSync('/proc/self/ns/net'), NP_PARENT_MNTNS: fs.readlinkSync('/proc/self/ns/mnt') },
  });
  assert.equal(child.status, 0, 'Isolated firewall acceptance failed');
} else {
  assert.notEqual(fs.readlinkSync('/proc/self/ns/net'), process.env.NP_PARENT_NETNS);
  assert.notEqual(fs.readlinkSync('/proc/self/ns/mnt'), process.env.NP_PARENT_MNTNS);
  const { originFirewall, installOriginFirewall, verifyOriginFirewall, removeOriginFirewall } = require('../../apps/server/dist/cloudflare/cf-origin-firewall.js');
  execFileSync('mount', ['--make-rprivate', '/']);
  execFileSync('mount', ['-t', 'tmpfs', 'tmpfs', '/etc']);
  execFileSync('ip', ['link', 'set', 'lo', 'up']);
  execFileSync('ip', ['addr', 'add', '104.16.0.1/32', 'dev', 'lo']);
  execFileSync('ip', ['-6', 'addr', 'add', '2606:4700::1/128', 'dev', 'lo', 'nodad']);
  const ssh = { execCommand: async command => {
    try { return { code: 0, ...await run('/bin/sh', ['-c', command], { timeout: 10000 }) }; }
    catch (e) { return { code: e.code || 1, stdout: e.stdout || '', stderr: e.stderr || '' }; }
  } };
  const ref = `np_origin_${'a'.repeat(32)}`;
  const f = originFirewall('fixture', 8443, ref);
  const tableState = () => execFileSync('nft', ['-s', 'list', 'table', 'inet', f.table], { encoding: 'utf8' });
  const servers = [];
  const request = async (port, source, family = 4) => (await run('curl', ['--noproxy', '*', `-${family}`, '--max-time', '2', '--silent', '--show-error',
    '--interface', source, `http://${family === 4 ? '127.0.0.1' : '[::1]'}:${port}/`], { timeout: 4000 })).stdout;
  (async () => {
    try {
      for (const port of [443, 8443]) {
        const server = http.createServer((_req, res) => res.end(String(port)));
        await new Promise((resolve, reject) => server.once('error', reject).listen(port, '::', resolve));
        servers.push(server);
      }
      assert.equal(await request(443, '127.0.0.1'), '443');
      await installOriginFirewall(ssh, 'fixture', 8443, ref);
      assert.ok(tableState().includes(`comment "${f.marker}"`), 'Ownership must be set on initial creation');
      await verifyOriginFirewall(ssh, 'fixture', 8443, ref);
      assert.equal(await request(443, '127.0.0.1'), '443', 'Existing website must remain reachable');
      assert.equal(await request(8443, '104.16.0.1'), '8443');
      assert.equal(await request(8443, '2606:4700::1', 6), '8443');
      await assert.rejects(request(8443, '127.0.0.1'));
      await assert.rejects(request(8443, '::1', 6));
      execFileSync('nft', ['delete', 'table', 'inet', f.table]);
      await assert.rejects(verifyOriginFirewall(ssh, 'fixture', 8443, ref));
      execFileSync('/bin/sh', [f.base + '.sh'], { stdio: 'inherit' });
      execFileSync('/bin/sh', [f.base + '.sh'], { stdio: 'inherit' });
      assert.ok(tableState().includes(`comment "${f.marker}"`), 'Ownership must survive repeated restoration');
      await verifyOriginFirewall(ssh, 'fixture', 8443, ref);
      await assert.rejects(request(8443, '127.0.0.1'));
      await removeOriginFirewall(ssh, 'fixture', 8443, ref);
      await removeOriginFirewall(ssh, 'fixture', 8443, ref);
      assert.equal(await request(443, '127.0.0.1'), '443');
      assert.equal(await request(8443, '127.0.0.1'), '8443');
      execFileSync('nft', ['-f', '-'], { input: `add table inet ${f.table} { comment "foreign-owner"; }\n` });
      const foreignState = tableState();
      await assert.rejects(installOriginFirewall(ssh, 'fixture', 8443, ref));
      assert.equal(tableState(), foreignState, 'Install must not take over a foreign table');
      await assert.rejects(removeOriginFirewall(ssh, 'fixture', 8443, ref));
      assert.equal(tableState(), foreignState, 'Cleanup must not delete a foreign table');
      assert.equal(await request(443, '127.0.0.1'), '443');
      execFileSync('nft', ['delete', 'table', 'inet', f.table]);
      console.log('PASS isolated nftables: website coexistence, IPv4/IPv6 CF-only ingress, restart, drift, idempotent cleanup and foreign ownership refusal');
    } finally { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
  })().catch(e => { console.error(e); process.exitCode = 1; });
}
