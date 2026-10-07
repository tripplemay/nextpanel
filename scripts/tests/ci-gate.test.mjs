import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('production deployment depends on the reusable validation gate without bypass conditions', () => {
  const workflow = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(workflow, /validate:\s+uses: \.\/\.github\/workflows\/validate\.yml/);
  assert.match(workflow, /deploy:\s+needs: validate/);
  assert.doesNotMatch(workflow, /continue-on-error:|if:\s*(always\(|\$\{\{\s*always\()/);
  const validation = readFileSync(join(root, '.github/workflows/validate.yml'), 'utf8');
  assert.match(validation, /pull_request:/);
  assert.match(validation, /workflow_call:/);
  assert.match(validation, /bash scripts\/ci\/verify.sh/);
  assert.doesNotMatch(validation, /secrets\.|continue-on-error:/);
});

for (const failure of ['apps/server:jest', 'root:ops', 'apps/server:nest', 'root:database', 'apps/web:tsc', 'apps/web:next', 'root:browser', '']) {
  test(`verification fails closed at ${failure || 'all stages succeed'}`, () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'np-ci-gate-')));
    try {
      mkdirSync(join(temp, 'scripts/ci'), { recursive: true });
      copyFileSync(join(root, 'scripts/ci/verify.sh'), join(temp, 'scripts/ci/verify.sh'));
      const shim = `#!/usr/bin/env bash
set -eu
name=$(basename "$0")
dir="\${PWD#"$TEST_ROOT"/}"
if [[ "$PWD" == "$TEST_ROOT" ]]; then dir=root; fi
if [[ "$name" == node ]]; then
  case "$*" in
    *database-integration*) name=database ;;
    *browser-smoke*) name=browser ;;
    *) name=ops ;;
  esac
fi
step="$dir:$name"
printf '%s\\n' "$step" >> "$TEST_ROOT/events"
[[ "$step" != "$FAIL_STEP" ]] || exit 42
`;
      for (const file of ['bin/node', 'apps/server/node_modules/.bin/prisma', 'apps/server/node_modules/.bin/tsc',
        'apps/server/node_modules/.bin/jest', 'apps/server/node_modules/.bin/nest',
        'apps/web/node_modules/.bin/tsc', 'apps/web/node_modules/.bin/next', 'packages/shared/node_modules/.bin/tsc']) {
        mkdirSync(dirname(join(temp, file)), { recursive: true });
        writeFileSync(join(temp, file), shim, { mode: 0o755 });
      }
      for (const file of ['scripts/nextpanel', 'scripts/install.sh', 'scripts/deploy-release.sh', 'apps/agent/install.sh']) {
        mkdirSync(dirname(join(temp, file)), { recursive: true });
        writeFileSync(join(temp, file), '#!/usr/bin/env bash\n');
      }
      const result = spawnSync('bash', ['scripts/ci/verify.sh'], {
        cwd: temp, encoding: 'utf8',
        env: { ...process.env, TEST_ROOT: temp, PG_BIN: '/fixture', FAIL_STEP: failure, PATH: `${temp}/bin:${process.env.PATH}` },
      });
      assert.equal(result.status, failure ? 42 : 0, result.stderr);
      const events = readFileSync(join(temp, 'events'), 'utf8').trim().split('\n');
      assert.equal(events.at(-1), failure || 'root:browser', 'no later stage may run after a failed gate');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}
