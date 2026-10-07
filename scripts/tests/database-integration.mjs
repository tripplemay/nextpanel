// Explicit opt-in: PG_BIN=/path/to/postgres/bin node --test scripts/tests/database-integration.mjs
// Always creates its own Unix-socket-only cluster; never reads project DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'apps/server/package.json'));
const { PrismaClient } = require('@prisma/client');
const bin = process.env.PG_BIN;
assert.ok(bin, 'PG_BIN must explicitly point at a PostgreSQL toolchain');

test('isolated PostgreSQL migration, concurrency and restore drill', { timeout: 120000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'np-pg-'));
  const socket = join(temp, 'socket');
  mkdirSync(socket);
  const env = { ...process.env, PGHOST: socket, PGPORT: '55432', PGUSER: 'review', PGDATABASE: 'nextpanel', PGCONNECT_TIMEOUT: '5' };
  delete env.DATABASE_URL;
  delete env.PGSERVICE;
  const run = (command, args, input) => execFileSync(join(bin, command), args, { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const sql = text => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-tA'], text).trim();
  let started = false;
  let prisma;
  try {
    run('initdb', ['-D', join(temp, 'data'), '-U', 'review', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
    run('pg_ctl', ['-D', join(temp, 'data'), '-l', join(temp, 'postgres.log'), '-o', `-h '' -k ${socket} -p 55432 -F`, '-w', 'start']);
    started = true;
    run('createdb', ['nextpanel']);
    sql('CREATE ROLE nextpanel;');

    const migrations = join(root, 'apps/server/prisma/migrations');
    const names = readdirSync(migrations).filter(n => /^\d/.test(n)).sort();
    for (const name of names.filter(n => n < '20261007000000')) {
      run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', join(migrations, name, 'migration.sql')]);
    }
    sql(`
      INSERT INTO "User" (id, username, "passwordHash", role, "updatedAt") VALUES ('owner', 'owner', 'fixture', 'OPERATOR', now());
      INSERT INTO "Server" (id, "userId", name, region, provider, ip, "sshAuthEnc", "agentToken", "updatedAt")
        VALUES ('srv', 'owner', 'fixture', 'test', 'test', '192.0.2.1', 'fixture', 'fixture', now());
      INSERT INTO "Node" (id, "serverId", "userId", name, protocol, "listenPort", "credentialsEnc", "updatedAt")
        VALUES ('node', 'srv', 'owner', 'fixture', 'VLESS', 443, 'fixture', now());
      INSERT INTO "OperationLog" (id, "resourceType", "resourceId", "resourceName", operation, success)
        VALUES ('known', 'node', 'node', 'fixture', 'DEPLOY', true), ('orphan', 'node', 'gone', 'deleted', 'DEPLOY', true);
      INSERT INTO "Subscription" (id, name, token, "ownerId", "updatedAt") VALUES ('sub', 'fixture', 'leaked-owner-token', 'owner', now());
      INSERT INTO "SubscriptionShare" (id, "subscriptionId", "userId", "shareToken") VALUES ('share', 'sub', 'owner', 'recipient-token');
    `);
    for (const name of names.filter(n => n >= '20261007000000')) {
      run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', join(migrations, name, 'migration.sql')]);
    }
    assert.equal(sql('SELECT "ownerId" FROM "OperationLog" WHERE id=\'known\''), 'owner');
    assert.equal(sql('SELECT "ownerId" IS NULL FROM "OperationLog" WHERE id=\'orphan\''), 't');
    assert.notEqual(sql('SELECT token FROM "Subscription" WHERE id=\'sub\''), 'leaked-owner-token');
    assert.equal(sql('SELECT "shareToken" FROM "SubscriptionShare" WHERE id=\'share\''), 'recipient-token');

    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://review@localhost:55432/nextpanel?host=${encodeURIComponent(socket)}` } } });
    await prisma.oAuthState.create({ data: { id: 'state', browserHash: 'browser', purpose: 'login', expiresAt: new Date(Date.now() + 60000) } });
    const consume = () => prisma.oAuthState.deleteMany({ where: { id: 'state', browserHash: 'browser', purpose: 'login', userId: null, expiresAt: { gt: new Date() } } });
    const counts = (await Promise.all([consume(), consume()])).map(r => r.count).sort();
    assert.deepEqual(counts, [0, 1]);
    await prisma.server.update({ where: { id: 'srv' }, data: { status: 'DELETING' } });
    assert.equal((await prisma.server.updateMany({ where: { id: 'srv', status: { notIn: ['DELETING', 'ERROR'] } }, data: { status: 'ONLINE' } })).count, 0);
    assert.equal((await prisma.server.findUnique({ where: { id: 'srv' } })).status, 'DELETING');
    await prisma.node.delete({ where: { id: 'node' } });
    assert.equal((await prisma.operationLog.findMany({ where: { ownerId: 'owner' } })).length, 1);
    assert.equal((await prisma.operationLog.findMany({ where: { ownerId: 'foreign' } })).length, 0);
    await prisma.$disconnect();
    prisma = undefined;

    sql("CREATE TABLE restore_marker(value text); INSERT INTO restore_marker VALUES ('REQUESTED');");
    const requested = join(temp, 'selected.sql.gz');
    writeFileSync(requested, gzipSync(run('pg_dump', ['nextpanel'])));
    sql("UPDATE restore_marker SET value='CURRENT';");
    const harness = `
      source "$CLI"
      APP_DIR="$TEST_ROOT"
      BACKUP_DIR="$TEST_ROOT/backups"
      check_root() { :; }
      check_install() { :; }
      pm2() { printf '%s\\n' "$*" >> "$TEST_ROOT/pm2-events"; }
      sudo() { shift 2; "$PG_BIN/$@"; }
      cmd_restore "$SELECTED" <<<y
    `;
    const restore = file => spawnSync('bash', ['-c', harness], { env: { ...env, CLI: join(root, 'scripts/nextpanel'), TEST_ROOT: temp, PG_BIN: bin, SELECTED: file }, encoding: 'utf8' });
    const success = restore(requested);
    assert.equal(success.status, 0, success.stdout + success.stderr);
    assert.equal(sql('SELECT value FROM restore_marker'), 'REQUESTED');
    sql("UPDATE restore_marker SET value='BEFORE_FAILED_RESTORE';");
    const invalid = join(temp, 'invalid.sql.gz');
    writeFileSync(invalid, gzipSync('SELECT * FROM nonexistent_restore_fixture;'));
    const failure = restore(invalid);
    assert.equal(failure.status, 1, failure.stdout + failure.stderr);
    assert.equal(sql('SELECT value FROM restore_marker'), 'BEFORE_FAILED_RESTORE');
    assert.ok(readFileSync(join(temp, 'pm2-events'), 'utf8').includes('restart ecosystem.config.cjs'));
  } finally {
    await prisma?.$disconnect();
    if (started) run('pg_ctl', ['-D', join(temp, 'data'), '-m', 'immediate', '-w', 'stop']);
    rmSync(temp, { recursive: true, force: true });
  }
});
