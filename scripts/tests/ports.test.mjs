import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => readFileSync(resolve(root, p), 'utf8');
const ecosystem = createRequire(import.meta.url)(resolve(root, 'ecosystem.config.cjs'));
test('only panel processes use the managed Node runtime without a pnpm child interpreter', () => {
  const managed = '/opt/apps/nextpanel-runtime/current/bin/node';
  assert.deepEqual(ecosystem.apps.map(app => app.name), ['nextpanel-server', 'nextpanel-web']);
  for (const app of ecosystem.apps) assert.equal(app.interpreter, existsSync(managed) ? managed : process.execPath);
  assert.equal(ecosystem.apps[0].script, 'dist/main.js');
  assert.equal(ecosystem.apps[1].script, 'node_modules/next/dist/bin/next');
  assert.ok(read('scripts/deploy-release.sh').includes('/opt/apps/nextpanel-runtime/current/bin:$PATH'));
});
test('production ports agree across PM2, installer, nginx and health probes', () => {
  const backend = ecosystem.apps.find(a => a.name === 'nextpanel-server').env.PORT;
  const frontend = ecosystem.apps.find(a => a.name === 'nextpanel-web').env.PORT;
  assert.equal(backend, 3201);
  assert.equal(frontend, 3200);
  for (const config of ['scripts/nginx/domain.conf', 'scripts/nginx/ip.conf', 'scripts/install.sh', 'scripts/nextpanel']) {
    assert.ok(read(config).includes(`127.0.0.1:${backend}`), config);
    assert.ok(read(config).includes(`127.0.0.1:${frontend}`), config);
  }
  for (const config of ['scripts/install.sh', 'scripts/nextpanel']) {
    assert.ok(read(config).includes('/api/health/ready'));
    assert.ok(!read(config).includes('/api/docs'));
  }
  assert.ok(read('scripts/install.sh').includes(`PORT=${backend}`));
  assert.ok(!read('apps/web/next.config.ts').includes(':3500'));
});
