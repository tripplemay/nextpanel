// Explicit opt-in: PG_BIN=/path/to/postgres/bin node --test scripts/tests/database-integration.mjs
// Always creates its own Unix-socket-only cluster; never reads project DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, symlinkSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'apps/server/package.json'));
const { PrismaClient } = require('@prisma/client');
require('ts-node').register({ project: join(root, 'apps/server/tsconfig.json'), transpileOnly: true });
const { CryptoService } = require(join(root, 'apps/server/src/common/crypto/crypto.service.ts'));
const { migrateExternalSecrets } = require(join(root, 'apps/server/src/external-nodes/migrate-external-secrets.ts'));
const { sealExternalSecrets, openExternalSecrets, externalNodePublicSelect } = require(join(root, 'apps/server/src/external-nodes/external-credentials.ts'));
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
      INSERT INTO "ExternalNode" (id, "userId", name, protocol, address, port, username, password, "rawUri", "shortId", "xhttpExtra", "updatedAt")
        VALUES ('ext-a', 'owner', 'legacy', 'HTTP', 'proxy.test', 80, 'proxy-user', 'proxy-pass', 'http://proxy-user:proxy-pass@proxy.test:80', '0123456789abcdef', '{"headers":{"Authorization":"private"}}', now()),
               ('ext-b', 'owner', 'legacy', 'HTTP', 'proxy.test', 80, NULL, NULL, NULL, NULL, NULL, now());
    `);
    for (const name of names.filter(n => n >= '20261007000000')) {
      run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', join(migrations, name, 'migration.sql')]);
    }
    assert.equal(sql('SELECT "ownerId" FROM "OperationLog" WHERE id=\'known\''), 'owner');
    assert.equal(sql('SELECT "ownerId" IS NULL FROM "OperationLog" WHERE id=\'orphan\''), 't');
    assert.notEqual(sql('SELECT token FROM "Subscription" WHERE id=\'sub\''), 'leaked-owner-token');
    assert.equal(sql('SELECT "shareToken" FROM "SubscriptionShare" WHERE id=\'share\''), 'recipient-token');

    prisma = new PrismaClient({ datasources: { db: { url: `postgresql://review@localhost:55432/nextpanel?host=${encodeURIComponent(socket)}` } } });
    const cipher = new CryptoService({ getOrThrow: () => 'ab'.repeat(32) });
    await prisma.externalNode.create({ data: { id: 'zzz', userId: 'owner', name: 'encrypted', protocol: 'HTTP', address: 'proxy.test', port: 80,
      credentialsEnc: sealExternalSecrets(cipher, 'owner', { password: 'existing-secret' }) } });
    const wrongKey = new CryptoService({ getOrThrow: () => 'cd'.repeat(32) });
    await assert.rejects(migrateExternalSecrets(prisma, wrongKey));
    assert.equal((await prisma.externalNode.findUnique({ where: { id: 'ext-a' } })).password, 'proxy-pass', 'failed migration must roll back earlier updates');
    assert.equal((await prisma.externalNode.findUnique({ where: { id: 'ext-a' } })).credentialsEnc, null);
    assert.equal(sql(`SELECT convalidated FROM pg_constraint WHERE conname='ExternalNode_encrypted_credentials'`), 'f');
    assert.equal(await migrateExternalSecrets(prisma, cipher), 2);
    assert.equal(await migrateExternalSecrets(prisma, cipher), 0, 'rerun must verify existing ciphertext without changing it');
    assert.equal(sql(`SELECT convalidated FROM pg_constraint WHERE conname='ExternalNode_encrypted_credentials'`), 't');
    const encrypted = await prisma.externalNode.findUnique({ where: { id: 'ext-a' } });
    for (const field of ['uuid', 'username', 'password', 'rawUri', 'xhttpExtra', 'shortId']) assert.equal(encrypted[field], null);
    assert.equal(openExternalSecrets(cipher, encrypted).password, 'proxy-pass');
    assert.equal(openExternalSecrets(cipher, encrypted).shortId, '0123456789abcdef');
    assert.equal(openExternalSecrets(cipher, encrypted).xhttpExtra, '{"headers":{"Authorization":"private"}}');
    const safeList = await prisma.externalNode.findMany({ select: externalNodePublicSelect });
    assert.ok(!JSON.stringify(safeList).includes('proxy-pass'));
    assert.ok(!('credentialsEnc' in safeList[0]));
    await assert.rejects(prisma.externalNode.update({ where: { id: 'ext-a' }, data: { password: 'plaintext' } }));
    await assert.rejects(prisma.externalNode.create({ data: { userId: 'owner', name: 'old-code', protocol: 'HTTP', address: 'proxy.test', port: 80 } }));
    const revoke = () => prisma.user.updateMany({ where: { id: 'owner', tokenVersion: 0 }, data: { tokenVersion: { increment: 1 } } });
    assert.deepEqual((await Promise.all([revoke(), revoke()])).map(r => r.count).sort(), [0, 1]);
    assert.equal((await prisma.user.findUnique({ where: { id: 'owner' } })).tokenVersion, 1);
    if (process.env.SERVER_BUILD_DIR) {
      const runnerRoot = join(temp, 'cli');
      mkdirSync(join(runnerRoot, 'apps/server'), { recursive: true });
      mkdirSync(join(runnerRoot, 'scripts'));
      copyFileSync(join(root, 'apps/server/package.json'), join(runnerRoot, 'apps/server/package.json'));
      symlinkSync(join(root, 'apps/server/node_modules'), join(runnerRoot, 'apps/server/node_modules'));
      cpSync(resolve(process.env.SERVER_BUILD_DIR), join(runnerRoot, 'apps/server/dist'), { recursive: true });
      const runner = join(runnerRoot, 'scripts/migrate-external-secrets.cjs');
      copyFileSync(join(root, 'scripts/migrate-external-secrets.cjs'), runner);
      const cliEnv = { ...env, DATABASE_URL: `postgresql://review@localhost:55432/nextpanel?host=${encodeURIComponent(socket)}`, ENCRYPTION_KEY: 'ab'.repeat(32) };
      const verified = spawnSync(process.execPath, [runner], { env: cliEnv, encoding: 'utf8' });
      assert.equal(verified.status, 0, verified.stdout + verified.stderr);
      assert.match(verified.stdout, /migrated 0 rows/);
      const failed = spawnSync(process.execPath, [runner], { env: { ...cliEnv, ENCRYPTION_KEY: 'cd'.repeat(32) }, encoding: 'utf8' });
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /transaction rolled back/);
      assert.ok(!failed.stderr.includes('proxy-pass') && !failed.stderr.includes('existing-secret'));
    }
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
