import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

for (const phase of ['success', 'schema', 'credentials']) {
  const fail = phase !== 'success';
  test(`release transaction: ${phase} ${fail ? 'failure restores exact release' : 'retains rollback'}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nextpanel-deploy-test-'));
    try {
      const app = path.join(root, 'apps/nextpanel');
      const id = 'a'.repeat(40);
      const candidate = path.join(root, `apps/nextpanel-candidate-${id}`);
      const backups = path.join(root, 'backups');
      for (const dir of [app, candidate]) {
        await fs.mkdir(path.join(dir, 'apps/server/dist'), { recursive: true });
        await fs.mkdir(path.join(dir, 'apps/web/.next'), { recursive: true });
        await fs.writeFile(path.join(dir, 'apps/server/dist/main.js'), 'fixture');
        await fs.writeFile(path.join(dir, 'apps/web/.next/BUILD_ID'), 'fixture');
        await fs.writeFile(path.join(dir, 'ecosystem.config.cjs'), 'fixture');
      }
      await fs.writeFile(path.join(app, 'apps/server/.env'), 'SECRET=keep-original');
      await fs.writeFile(path.join(app, 'OLD_RELEASE'), 'original');
      const bin = path.join(root, 'bin');
      await fs.mkdir(bin);
      const mocks = {
        flock: 'exit 0', pm2: 'exit 0', curl: 'printf 401',
        pnpm: `if [[ "$*" == 'exec prisma migrate deploy' ]]; then exit ${phase === 'schema' ? 9 : 0}; fi`,
        node: `[[ "$*" == *migrate-external-secrets.cjs* ]] || exit 8\nexit ${phase === 'credentials' ? 9 : 0}`,
        docker: `printf '%s\\n' "$*" >> '${root}/docker.log'\nif [[ "$*" == *pg_dump* ]]; then echo fake-dump; else cat >/dev/null; fi`,
        sha256sum: 'echo checksum',
      };
      for (const [name, body] of Object.entries(mocks)) {
        await fs.writeFile(path.join(bin, name), '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
      }
      const source = (await fs.readFile(new URL('../deploy-release.sh', import.meta.url), 'utf8'))
        .replaceAll('/opt/apps', path.join(root, 'apps')).replace('/opt/backups/nextpanel/releases', backups);
      const script = path.join(root, 'deploy.sh');
      await fs.writeFile(script, source);
      const result = spawnSync('/bin/bash', [script, 'deploy', id], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, fail ? 9 : 0, result.stdout + result.stderr);
      assert.equal(await fs.readFile(path.join(app, 'apps/server/.env'), 'utf8'), 'SECRET=keep-original');
      if (fail) {
        assert.match(result.stdout, /Rollback verified/, result.stdout + result.stderr);
        assert.equal(await fs.readFile(path.join(app, 'OLD_RELEASE'), 'utf8'), 'original');
        assert.match(await fs.readFile(path.join(root, 'docker.log'), 'utf8'), /dropdb/);
        await fs.access(path.join(backups, id, 'ROLLED_BACK'));
      } else {
        await fs.access(path.join(backups, id, 'app/OLD_RELEASE'));
        await fs.access(path.join(backups, id, 'VERIFIED'));
      }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}
