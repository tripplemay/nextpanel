import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function verifyUsage({ prisma, cipher, require, root, databaseUrl }) {
  const { UsageService } = require(join(root, 'apps/server/src/usage/usage.service.ts'));
  const oldUrl = process.env.DATABASE_URL; const oldFlag = process.env.USAGE_OBSERVATION_ENABLED;
  process.env.DATABASE_URL = databaseUrl; process.env.USAGE_OBSERVATION_ENABLED = 'true';
  const service = new UsageService(prisma, cipher);
  try {
    await prisma.user.create({ data: { id: 'usage-viewer', username: 'usage-viewer', passwordHash: 'fixture' } });
    await prisma.node.create({ data: { id: 'usage-node', userId: 'owner', serverId: 'srv', name: 'usage fixture', protocol: 'VLESS', implementation: 'XRAY', transport: 'WS', tls: 'TLS', listenPort: 24443,
      cfDnsRecordId: 'record', domain: 'cdn.example.com', status: 'RUNNING', credentialsEnc: cipher.encrypt('{}') } });
    await prisma.subscription.create({ data: { id: 'usage-sub', name: 'usage fixture', ownerId: 'owner', token: 'usage-owner-token', cfAuto: true, cfProtectedNodeIds: ['usage-node'], nodes: { create: { nodeId: 'usage-node' } } } });
    await prisma.subscriptionShare.create({ data: { id: 'usage-share', subscriptionId: 'usage-sub', userId: 'usage-viewer', shareToken: 'usage-share-token' } });
    await assert.rejects(service.setEnabled('usage-sub', 'usage-viewer', true));
    await service.setEnabled('usage-sub', 'owner', true);
    const variant = { name: 'CF generic 1', protocol: 'VLESS', tls: 'TLS', transport: 'WS', host: '104.16.0.1', domain: 'cdn.example.com', port: 443, cfCarrier: 'GENERIC', credentials: { uuid: 'legacy', transportHost: 'cdn.example.com' } };
    const grant = { subscriptionId: 'usage-sub', ownerId: 'owner', subjectUserId: 'owner', grantId: 'owner', token: 'usage-owner-token' };
    const share = { ...grant, subjectUserId: 'usage-viewer', grantId: 'usage-share', token: 'usage-share-token' };
    assert.deepEqual(await service.decorate('usage-node', grant, [variant]), [variant]);
    await Promise.all([service.decorate('usage-node', grant, [variant]), service.decorate('usage-node', share, [variant])]);
    let credentials = await prisma.usageCredential.findMany({ where: { nodeId: 'usage-node' } });
    assert.equal(credentials.length, 2, 'concurrent requests must deduplicate each grant');
    assert.notEqual(credentials[0].uuidEnc, credentials[1].uuidEnc);
    assert.equal(JSON.stringify(await service.overview('usage-viewer')).includes('usage fixture'), false, 'foreign owner cannot observe shared subscriber records');
    await prisma.usageNode.update({ where: { nodeId: 'usage-node' }, data: { preparedAt: new Date() } });
    await prisma.usageCredential.updateMany({ where: { nodeId: 'usage-node' }, data: { installedAt: new Date() } });
    const ownerExport = await service.decorate('usage-node', grant, [variant]);
    const shareExport = await service.decorate('usage-node', share, [variant]);
    assert.notEqual(ownerExport[0].credentials.uuid, shareExport[0].credentials.uuid);
    assert.equal(ownerExport[0].host, variant.host); assert.equal(ownerExport[0].credentials.transportHost, variant.credentials.transportHost);
    const blocker = new (require('pg').Client)({ connectionString: databaseUrl });
    await blocker.connect();
    try {
      await blocker.query('SELECT pg_advisory_lock(hashtextextended($1::text, 0))', ['nextpanel:usage:usage-node']);
      const began = Date.now();
      assert.deepEqual(await service.decorate('usage-node', grant, [variant]), [variant], 'SSH contention must return unchanged CDN credentials');
      assert.ok(Date.now() - began < 3000, 'downloads must not wait for a long remote operation');
    } finally { await blocker.end(); }
    assert.deepEqual(await service.decorate('usage-node', grant, [variant]), ownerExport, 'installed identities resume after contention');
    const id = credentials.find(c => c.grantId === 'owner').id;
    const start = Date.now() - 20_000;
    const sample = (index, up) => ({ nodeId: 'usage-node', sampleId: `fixture-${index}`, sampledAt: new Date(start + index * 1000).toISOString(), uptime: 100 + index,
      users: [{ email: `np-usage-${id}`, upBytes: String(up), downBytes: '0' }] });
    await service.ingest('foreign', [sample(0, 100)]);
    assert.equal((await prisma.usageNode.findUnique({ where: { nodeId: 'usage-node' } })).sampledAt, null);
    await service.ingest('srv', [sample(0, 100)]);
    assert.equal((await prisma.usageCredential.findUnique({ where: { id } })).lastActiveAt, null, 'first counter is only a baseline');
    assert.equal((await service.overview('owner', 'usage-sub')).rows.find(r => r.id === id).upRate, null, 'a baseline must not masquerade as measured zero');
    await service.ingest('srv', [sample(10, 1100)]);
    await service.ingest('srv', [sample(10, 1100), sample(5, 600)]);
    const updated = await prisma.usageCredential.findUnique({ where: { id } });
    assert.equal(updated.upRate, 100);
    const buckets = await service.history(id, 'owner');
    assert.equal(buckets.reduce((sum, b) => sum + Number(b.upBytes), 0), 1000, 'duplicates and out-of-order samples cannot double count');
    const view = await service.overview('owner', 'usage-sub');
    assert.equal(view.rows.find(r => r.id === id).status, 'ACTIVE');
    assert.equal(view.rows.find(r => r.id === id).actualEdgeIp, null);
    const json = JSON.stringify(view);
    for (const secret of ['uuidEnc', 'usage-owner-token', 'usage-share-token', ownerExport[0].credentials.uuid, shareExport[0].credentials.uuid]) assert.ok(!json.includes(secret));
    await service.setEnabled('usage-sub', 'owner', false);
    assert.ok((await service.overview('owner', 'usage-sub')).rows.every(r => r.status === 'PAUSED'));
    await service.setEnabled('usage-sub', 'owner', true);
    assert.equal((await prisma.usageCredential.findUniqueOrThrow({ where: { id } })).sampledAt, null);
    await service.ingest('srv', [sample(20, 2100)]);
    const resumed = await prisma.usageCredential.findUniqueOrThrow({ where: { id } });
    assert.equal(resumed.upRate, null, 'a brief pause/resume requires a new baseline even inside the freshness window');
    assert.equal(resumed.lastActiveAt, null, 'paused traffic must not appear as recent activity');
    assert.equal((await service.history(id, 'owner')).reduce((sum, b) => sum + Number(b.upBytes), 0), 1000, 'paused bytes must not enter history');
    await service.setEnabled('usage-sub', 'owner', false);
    await service.revokeInvalidGrants('usage-node');
    assert.equal(await prisma.usageCredential.count({ where: { nodeId: 'usage-node', revokedAt: { not: null } } }), 0, 'pausing observation must not revoke proxy access');
    await prisma.subscriptionShare.delete({ where: { id: 'usage-share' } });
    await service.revokeInvalidGrants('usage-node');
    credentials = await prisma.usageCredential.findMany({ where: { nodeId: 'usage-node' } });
    assert.ok(credentials.find(c => c.grantId === 'usage-share').revokedAt);
    assert.equal(credentials.find(c => c.grantId === 'owner').revokedAt, null);
    await assert.rejects(service.history(id, 'usage-viewer'));
    await service.setEnabled('usage-sub', 'owner', true);
    for (const removed of [false, true]) {
      const old = await prisma.usageCredential.findFirstOrThrow({ where: { nodeId: 'usage-node', grantId: 'owner', revokedAt: null } });
      await prisma.subscriptionNode.deleteMany({ where: { subscriptionId: 'usage-sub', nodeId: 'usage-node' } });
      await service.revokeInvalidGrants('usage-node');
      if (removed) await prisma.usageCredential.update({ where: { id: old.id }, data: { removedAt: new Date() } });
      await prisma.subscriptionNode.create({ data: { subscriptionId: 'usage-sub', nodeId: 'usage-node' } });
      const renewed = await Promise.all([service.decorate('usage-node', grant, [variant]), service.decorate('usage-node', grant, [variant])]);
      assert.deepEqual(renewed, [[variant], [variant]], 'renewed identity must remain unpublished until installed');
      const fresh = await prisma.usageCredential.findMany({ where: { nodeId: 'usage-node', grantId: 'owner', revokedAt: null } });
      assert.equal(fresh.length, 1, 'renewed membership deduplicates concurrent downloads');
      assert.notEqual(fresh[0].id, old.id); assert.notEqual(cipher.decrypt(fresh[0].uuidEnc), cipher.decrypt(old.uuidEnc));
      const tombstone = await prisma.usageCredential.findUniqueOrThrow({ where: { id: old.id } });
      assert.ok(tombstone.revokedAt); assert.equal(tombstone.uuidEnc, old.uuidEnc);
      assert.equal(!!tombstone.removedAt, removed, 'old identity still requires removal when not yet confirmed');
      await prisma.usageCredential.update({ where: { id: fresh[0].id }, data: { installedAt: new Date() } });
      assert.equal((await service.decorate('usage-node', grant, [variant]))[0].credentials.uuid, cipher.decrypt(fresh[0].uuidEnc));
    }
    assert.equal((await service.history(id, 'owner')).reduce((sum, b) => sum + Number(b.upBytes), 0), 1000, 'renewal preserves old identity history');
    process.env.USAGE_OBSERVATION_ENABLED = 'false';
    assert.deepEqual(await service.decorate('usage-node', grant, [variant]), [variant]);
  } finally {
    await prisma.subscription.deleteMany({ where: { id: 'usage-sub' } });
    await prisma.node.deleteMany({ where: { id: 'usage-node' } });
    await prisma.user.deleteMany({ where: { id: 'usage-viewer' } });
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    if (oldFlag === undefined) delete process.env.USAGE_OBSERVATION_ENABLED; else process.env.USAGE_OBSERVATION_ENABLED = oldFlag;
  }
}
