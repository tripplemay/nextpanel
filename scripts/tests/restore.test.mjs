import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../nextpanel');
const harness = `
source "$CLI"
APP_DIR="$TEST_ROOT/app"
BACKUP_DIR="$TEST_ROOT/backups"
MAX_BACKUPS=1
check_root() { :; }
check_install() { :; }
pm2() {
  printf 'pm2 %s\\n' "$*" >> "$TEST_ROOT/events"
  if [ "$MODE" = stop-failure ] && [ "$1" = stop ]; then return 1; fi
}
sudo() {
  shift 2
  printf '%s\\n' "$*" >> "$TEST_ROOT/events"
  case "$1" in
    pg_dump)
      [ "$MODE" != backup-failure ] || return 1
      command cat "$TEST_ROOT/db" ;;
    dropdb) rm -f "$TEST_ROOT/db" ;;
    createdb) touch "$TEST_ROOT/db" ;;
    psql)
      [[ "$*" == *ON_ERROR_STOP=1* ]] || return 9
      local input
      input=$(command cat)
      if [ "$input" = BAD ] || [ "$MODE" = rollback-failure ]; then return 1; fi
      printf '%s' "$input" > "$TEST_ROOT/db" ;;
    *) return 99 ;;
  esac
}
cmd_restore "$TEST_ROOT/selected.sql.gz" <<<y
`;

for (const mode of ['success', 'sql-failure', 'rollback-failure', 'backup-failure', 'stop-failure']) {
  test(`restore isolation: ${mode}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'nextpanel-restore-'));
    try {
      mkdirSync(join(root, 'app'));
      writeFileSync(join(root, 'db'), 'ORIGINAL');
      writeFileSync(join(root, 'selected.sql.gz'), gzipSync(mode.includes('sql-') || mode === 'rollback-failure' ? 'BAD' : 'REQUESTED'));
      const result = spawnSync('bash', ['-c', harness], {
        env: { ...process.env, CLI: cli, TEST_ROOT: root, MODE: mode }, encoding: 'utf8',
      });
      const events = readFileSync(join(root, 'events'), 'utf8');
      assert.equal(result.status, mode === 'success' ? 0 : 1, result.stdout + result.stderr);
      if (mode === 'success') assert.equal(readFileSync(join(root, 'db'), 'utf8'), 'REQUESTED');
      else if (mode !== 'rollback-failure') assert.equal(readFileSync(join(root, 'db'), 'utf8'), 'ORIGINAL');
      if (mode === 'success' || mode === 'sql-failure') {
        assert.ok(events.indexOf('stop nextpanel-server') < events.indexOf('pg_dump'));
        assert.ok(events.includes('pm2 restart ecosystem.config.cjs'));
        const backups = readdirSync(join(root, 'backups')).filter(f => f.endsWith('.sql.gz'));
        assert.equal(backups.length, 1);
        assert.equal(gunzipSync(readFileSync(join(root, 'backups', backups[0]))).toString(), 'ORIGINAL');
      }
      if (mode === 'rollback-failure') assert.ok(!events.includes('restart'));
      if (mode === 'backup-failure' || mode === 'stop-failure') assert.ok(!events.includes('dropdb'));
      if (mode === 'sql-failure') assert.equal(events.match(/dropdb/g)?.length, 2);
      assert.ok(readFileSync(join(root, 'selected.sql.gz')).length > 0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
