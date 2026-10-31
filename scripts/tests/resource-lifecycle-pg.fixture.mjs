import assert from 'node:assert/strict';

// Invoked only by the isolated PostgreSQL harness, never against project DATABASE_URL.
export async function verifyResourceLifecycle({ prisma, cipher, databaseUrl, require, root, sql }) {
  const { ResourceLifecycleService } = require(`${root}/apps/server/src/resources/resource-lifecycle.service.ts`);
  const { ResourceCleanupScheduler } = require(`${root}/apps/server/src/nodes/resource-cleanup.scheduler.ts`);
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  try {
    await prisma.user.create({ data: { id: 'life-owner', username: 'lifecycle', passwordHash: 'fixture' } });
    const server = id => ({ id, userId: 'life-owner', name: id, region: 'fixture', provider: 'fixture', ip: id === 'life-entry' ? '192.0.2.10' : '192.0.2.11', sshAuthEnc: cipher.encrypt('fixture-password') });
    await prisma.server.createMany({ data: [server('life-entry'), server('life-exit'), server('life-empty')] });
    await prisma.cloudflareSetting.create({ data: { userId: 'life-owner', domain: 'fixture.test', zoneId: 'original-zone', apiTokenEnc: cipher.encrypt('fixture-token') } });
    await prisma.node.create({ data: {
      id: 'life-node', userId: 'life-owner', name: 'life-chain', serverId: 'life-entry', protocol: 'VLESS', listenPort: 17000,
      credentialsEnc: cipher.encrypt('{"uuid":"fixture"}'), exitServerId: 'life-exit', exitPort: 15000, exitType: 'MANAGED_SERVER',
      chainCredEnc: cipher.encrypt('fixture-exit-uuid'), cfDnsRecordId: 'fixture-record', domain: 'np-life.fixture.test',
      snapshots: { create: { version: 1, content: cipher.encrypt('{"fixture":"approved"}'), checksum: 'encrypted-checksum' } },
    } });
    const resources = new ResourceLifecycleService(prisma, cipher);
    // Remote inventory is separately exercised by SSH fixtures; no external access here.
    resources.scan = async (id, ownerId) => {
      await resources.observeServices({ id, userId: ownerId }, [], true);
      return resources.list(ownerId);
    };
    await assert.rejects(resources.queueServerDeletion('life-entry', 'foreign', true), /not found/);
    assert.equal(await prisma.resourceCleanup.count(), 0);
    sql(`CREATE FUNCTION lifecycle_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture transaction failure'; END $$;
      CREATE TRIGGER lifecycle_reject_delete BEFORE DELETE ON "Node" FOR EACH ROW WHEN (OLD.id = 'life-node') EXECUTE FUNCTION lifecycle_reject_delete();`);
    await assert.rejects(resources.queueServerDeletion('life-entry', 'life-owner', true), /fixture transaction failure/);
    assert.equal(await prisma.resourceCleanup.count(), 0, 'failed cascade must roll back cleanup intent too');
    assert.equal((await prisma.server.findUniqueOrThrow({ where: { id: 'life-entry' } })).retiredAt, null);
    assert.equal(await prisma.node.count({ where: { id: 'life-node' } }), 1);
    sql('DROP TRIGGER lifecycle_reject_delete ON "Node"; DROP FUNCTION lifecycle_reject_delete();');

    const deletion = await Promise.all([
      resources.queueServerDeletion('life-entry', 'life-owner', true),
      resources.queueServerDeletion('life-entry', 'life-owner', true),
    ]);
    assert.ok(deletion.every(r => r.cleanupPending));
    const queued = await prisma.resourceCleanup.findMany({ where: { nodeId: 'life-node' } });
    assert.equal(queued.length, 3, 'concurrent deletes must not duplicate tasks');
    assert.deepEqual(queued.map(j => j.role).sort(), ['DNS', 'ENTRY', 'EXIT']);
    assert.equal(queued.find(j => j.role === 'EXIT').serverId, 'life-exit');
    assert.equal(queued.find(j => j.role === 'DNS').payload.cfZoneId, 'original-zone');
    const fingerprint = queued.find(j => j.role === 'ENTRY').expectedConfigHashEnc;
    assert.match(cipher.decrypt(fingerprint), /^[a-f0-9]{64}$/);
    assert.notEqual(fingerprint, cipher.decrypt(fingerprint), 'config fingerprints must not expose a plaintext password oracle');
    assert.equal(await prisma.node.count({ where: { id: 'life-node' } }), 0);
    assert.equal(await prisma.configSnapshot.count({ where: { nodeId: 'life-node' } }), 0);
    const retired = await prisma.server.findUniqueOrThrow({ where: { id: 'life-entry' } });
    assert.ok(retired.retiredAt && retired.cleanupQueuedAt && retired.sshAuthEnc);
    assert.deepEqual((await resources.list('foreign')).tasks, []);
    await assert.rejects(resources.retry(queued[0].id, 'foreign'), /not found/);

    const executions = [];
    const deploy = { cleanupDetachedResource: async job => {
      executions.push(job.id);
      await new Promise(resolve => setTimeout(resolve, 20));
      if (job.role === 'ENTRY') throw new Error('fixture offline entry');
    } };
    // Separate worker objects use real PostgreSQL session locks, not Jest lock mocks.
    await Promise.all([
      new ResourceCleanupScheduler(prisma, resources, deploy).tick(),
      new ResourceCleanupScheduler(prisma, resources, deploy).tick(),
    ]);
    assert.equal(executions.length, 3);
    assert.equal(new Set(executions).size, 3, 'each resource executes only once across workers');
    const after = await prisma.resourceCleanup.findMany({ where: { nodeId: 'life-node' } });
    assert.equal(after.find(j => j.role === 'ENTRY').state, 'PENDING');
    assert.ok(after.filter(j => j.role !== 'ENTRY').every(j => j.state === 'DONE'));
    assert.ok(await prisma.server.findUnique({ where: { id: 'life-entry' } }), 'unreachable host credentials must survive');

    await prisma.resourceCleanup.update({ where: { id: after.find(j => j.role === 'ENTRY').id }, data: { state: 'RUNNING', nextAttemptAt: new Date(0) } });
    await new ResourceCleanupScheduler(prisma, resources, { cleanupDetachedResource: async () => {} }).tick();
    assert.equal(await prisma.server.findUnique({ where: { id: 'life-entry' } }), null, 'restart resumes stale lease then finalizes retirement');
    assert.ok(await prisma.server.findUnique({ where: { id: 'life-exit' } }), 'peer registration must not be deleted');
    assert.equal(await prisma.resourceCleanup.count({ where: { nodeId: 'life-node', state: 'DONE' } }), 3, 'audit history survives server deletion');

    await resources.queueServerDeletion('life-empty', 'life-owner', false);
    await resources.finishRetiredServers();
    assert.equal(await prisma.server.findUnique({ where: { id: 'life-empty' } }), null, 'zero-node deletion must also finalize');
    await prisma.server.create({ data: server('life-incomplete') });
    await assert.rejects(prisma.node.create({ data: { id: 'life-incomplete-node', userId: 'life-owner', name: 'incomplete legacy chain', serverId: 'life-incomplete',
      protocol: 'VLESS', listenPort: 17001, credentialsEnc: cipher.encrypt('fixture'), exitServerId: 'life-exit', exitPort: 15001 } }), /Node_chain_exit_shape_check/);
    process.stdout.write('Resource lifecycle: atomic intent/cascade, duplicate deletion, two workers, independent exits, restart recovery PASS\n');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}
