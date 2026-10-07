import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.BROWSER_TEST_PORT || 3409);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid fixture port');
const base = `http://127.0.0.1:${port}`;
// Refuse to test an unrelated/pre-existing server on the requested port.
const probe = createServer();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
await new Promise(resolve => probe.close(resolve));
mkdirSync(join(root, 'out/ci'), { recursive: true });
const log = openSync(join(root, 'out/ci/browser-server.log'), 'w');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: join(root, 'apps/web'), stdio: ['ignore', log, log], detached: true,
});
const exited = new Promise(resolve => server.once('exit', resolve));
let startupError;
server.once('error', error => { startupError = error; });
try {
  const deadline = Date.now() + 60000;
  while (true) {
    if (startupError) throw startupError;
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Fixture server exited; see out/ci/browser-server.log');
    try {
      const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      if (response.ok) break;
    } catch { /* wait for the isolated frontend */ }
    if (Date.now() > deadline) throw new Error('Fixture server did not become ready');
    await sleep(250);
  }
  for (const script of ['security-closeout-browser.py', 'p1-browser.py']) {
    const child = spawn(process.env.PYTHON || 'python3', [join(root, 'scripts/tests', script), base], { stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    if (code !== 0) throw new Error(`${script} failed (${code})`);
  }
} finally {
  if (server.pid && server.exitCode === null && server.signalCode === null) {
    process.kill(-server.pid, 'SIGTERM');
    await Promise.race([exited, sleep(5000)]);
    if (server.exitCode === null && server.signalCode === null) process.kill(-server.pid, 'SIGKILL');
  }
  closeSync(log);
}
