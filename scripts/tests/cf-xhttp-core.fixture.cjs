// Install the real pinned core in a private mount namespace, never on the CI host.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync, execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0);
if (process.argv[2] !== 'isolated') {
  const result = spawnSync('unshare', ['--mount', '--fork', process.execPath, __filename, 'isolated'], {
    stdio: 'inherit', env: { ...process.env, NP_PARENT_MNTNS: fs.readlinkSync('/proc/self/ns/mnt') },
  });
  assert.equal(result.status, 0);
} else {
  assert.notEqual(fs.readlinkSync('/proc/self/ns/mnt'), process.env.NP_PARENT_MNTNS);
  const { ensureCfXhttpCore, CF_XHTTP_CORE_BIN } = require('../../apps/server/dist/nodes/protocols/cf-xhttp-core.js');
  execFileSync('mount', ['--make-rprivate', '/']);
  for (const path of ['/usr/local/bin', '/usr/local/lib']) execFileSync('mount', ['-t', 'tmpfs', 'tmpfs', path]);
  const shared = '/usr/local/bin/xray';
  fs.writeFileSync(shared, '#!/bin/sh\nprintf "Xray 26.3.27 fixture\\n"\n', { mode: 0o755 });
  const hash = path => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
  const baseline = hash(shared);
  const ssh = { execCommand: async command => {
    try { return { code: 0, ...await promisify(execFile)('/bin/sh', ['-c', command], { timeout: 270000 }) }; }
    catch (e) { return { code: e.code || 1, stdout: e.stdout || '', stderr: e.stderr || '' }; }
  }, dispose() {} };
  (async () => {
    assert.equal(await ensureCfXhttpCore(ssh), CF_XHTTP_CORE_BIN);
    assert.equal(hash(shared), baseline, 'A newer shared core must not be downgraded');
    assert.match(execFileSync(CF_XHTTP_CORE_BIN, ['version'], { encoding: 'utf8' }), /^Xray 26\.10\.31\b/);
    const installed = hash(CF_XHTTP_CORE_BIN);
    assert.equal(await ensureCfXhttpCore(ssh), CF_XHTTP_CORE_BIN);
    assert.equal(hash(CF_XHTTP_CORE_BIN), installed, 'Retry must reuse the installed artifact');
    assert.equal(hash(shared), baseline);
    console.log('PASS isolated Xray: official pinned install, idempotent retry and unchanged shared core');
  })().catch(e => { console.error(e); process.exitCode = 1; });
}
