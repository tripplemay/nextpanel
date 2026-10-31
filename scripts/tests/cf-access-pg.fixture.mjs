import assert from 'node:assert/strict';

// Called exclusively inside database-integration.mjs's disposable local cluster.
export async function verifyCfAccess({ prisma, cipher, require, root, databaseUrl }) {
  const { CfAccessService } = require(`${root}/apps/server/src/subscriptions/cf-access.service.ts`);
  const { SubscriptionsService } = require(`${root}/apps/server/src/subscriptions/subscriptions.service.ts`);
  const { buildCfUnavailableProvider } = require(`${root}/apps/server/src/subscriptions/uri-builder.ts`);
  const original = await prisma.subscription.findUniqueOrThrow({ where: { id: 'sub' } });
  assert.equal(original.cfOnly, false);
  assert.equal(original.cfAuto, false);
  assert.deepEqual(original.cfPreferredIps, []);
  assert.deepEqual(original.cfProtectedNodeIds, []);
  const resourceCount = await prisma.configSnapshot.count();
  const cleanupCount = await prisma.resourceCleanup.count();
  const nodeCount = await prisma.node.count();
  await prisma.user.create({ data: { id: 'cf-owner', username: 'cf-owner', passwordHash: 'fixture' } });
  await prisma.server.create({ data: { id: 'cf-entry', userId: 'cf-owner', name: 'CF entry', region: 'fixture', provider: 'fixture',
    ip: '192.0.2.90', sshAuthEnc: cipher.encrypt('fixture') } });
  await prisma.node.create({ data: {
    id: 'cf-node', userId: 'cf-owner', serverId: 'cf-entry', name: 'CF fixture', protocol: 'VLESS',
    transport: 'WS', tls: 'TLS', listenPort: 443, domain: 'cdn.example.com', cfDnsRecordId: 'fixture-record', status: 'RUNNING',
    credentialsEnc: cipher.encrypt(JSON.stringify({ uuid: 'cf-fixture', path: '/ws' })),
  } });
  const nodes = { getCredentials: async (id, userId) => {
    const node = await prisma.node.findFirstOrThrow({ where: { id, userId } });
    return JSON.parse(cipher.decrypt(node.credentialsEnc));
  } };
  const cf = new CfAccessService(prisma, nodes, { testWithParams: async () => { throw new Error('No network in PG fixture'); } });
  cf.defaultIp = async () => '104.16.0.2';
  const { CfOptimizationService, nodeFingerprint } = require(`${root}/apps/server/src/subscriptions/cf-optimization.service.ts`);
  const { fingerprint } = require(`${root}/apps/server/src/subscriptions/cf-optimization.util.ts`);
  const optimizer = new CfOptimizationService(prisma, nodes, cf);
  const subscriptions = new SubscriptionsService(prisma, nodes, { get: () => 'https://panel.example.com' }, cipher, cf, optimizer);
  await prisma.node.create({ data: { id: 'cf-ordinary', userId: 'cf-owner', serverId: 'cf-entry', name: 'Ordinary fixture',
    protocol: 'TROJAN', transport: 'TCP', tls: 'TLS', listenPort: 8443, status: 'RUNNING', credentialsEnc: cipher.encrypt(JSON.stringify({ password: 'fixture' })) } });
  const { sealExternalSecrets } = require(`${root}/apps/server/src/external-nodes/external-credentials.ts`);
  await prisma.externalNode.create({ data: { id: 'cf-external', userId: 'cf-owner', name: 'External fixture',
    protocol: 'TROJAN', address: '192.0.2.92', port: 443, tls: 'TLS',
    credentialsEnc: sealExternalSecrets(cipher, 'cf-owner', { password: 'fixture-external' }) } });
  const mixed = await subscriptions.create('Mixed fixture', ['cf-node', 'cf-ordinary'], 'cf-owner', ['cf-external'], { cfAuto: true });
  assert.equal(mixed.cfOnly, false); assert.deepEqual(mixed.cfProtectedNodeIds, ['cf-node']);
  const mixedShare = await subscriptions.addShare(mixed.id, 'owner', 'cf-owner');
  const mixedProvider = await subscriptions.generateCfProvider({ token: mixed.token }, 'cf-node');
  assert.ok(mixedProvider.includes('104.16.0.2')); assert.ok(!mixedProvider.includes('192.0.2.92'));
  assert.equal(mixedProvider, await subscriptions.generateCfProvider({ shareToken: mixedShare.shareToken }, 'cf-node'));
  const mixedClash = (await subscriptions.generateClashContent(mixed.token)).content;
  assert.ok(mixedClash.slice(mixedClash.indexOf('  - name: 🚀')).includes('Ordinary fixture'));
  assert.ok(mixedClash.includes('External fixture'));
  await subscriptions.update(mixed.id, undefined, undefined, 'cf-owner', undefined, { cfAuto: false });
  const stopped = await prisma.subscription.findUniqueOrThrow({ where: { id: mixed.id } });
  assert.deepEqual(stopped.cfProtectedNodeIds, ['cf-node']); assert.equal(stopped.token, mixed.token);
  await assert.rejects(prisma.subscription.update({ where: { id: mixed.id, updatedAt: new Date(0) }, data: { cfProtectedNodeIds: [] } }));
  await subscriptions.update(mixed.id, undefined, undefined, 'cf-owner', undefined, { cfAuto: true });
  const savedDns = cf.defaultIp;
  cf.defaultIp = async () => null;
  const withoutCf = Buffer.from(await subscriptions.generateContent(mixed.token), 'base64').toString();
  assert.equal(withoutCf.split('\n').length, 2); assert.ok(!withoutCf.includes('cdn.example.com'));
  assert.equal(await subscriptions.generateCfProvider({ token: mixed.token }, 'cf-node'), buildCfUnavailableProvider('cf-node'));
  cf.defaultIp = savedDns;
  await prisma.node.update({ where: { id: 'cf-node' }, data: { transport: 'TCP' } });
  assert.equal(await subscriptions.generateCfProvider({ token: mixed.token }, 'cf-node'), buildCfUnavailableProvider('cf-node'));
  assert.ok(!Buffer.from(await subscriptions.generateContent(mixed.token), 'base64').toString().includes('cdn.example.com'));
  await prisma.node.update({ where: { id: 'cf-node' }, data: { transport: 'WS' } });
  await subscriptions.remove(mixed.id, 'cf-owner');
  await prisma.node.delete({ where: { id: 'cf-ordinary' } });
  await prisma.externalNode.delete({ where: { id: 'cf-external' } });
  await assert.rejects(subscriptions.create('foreign', ['cf-node'], 'owner', [], { cfOnly: true }), /selection is not available/);
  const created = await subscriptions.create('CF fixture', ['cf-node'], 'cf-owner', [], { cfOnly: true, cfPreferredIps: ['104.16.0.1'] });
  assert.equal(created.cfOnly, true);
  await assert.rejects(prisma.subscription.update({ where: { id: created.id, cfOnly: false }, data: { cfOnly: false } }));
  assert.deepEqual(created.cfPreferredIps, ['104.16.0.1']);
  const share = await subscriptions.addShare(created.id, 'owner', 'cf-owner');
  const content = await subscriptions.generateContent(created.token);
  assert.equal(content, await subscriptions.generateContentByShareToken(share.shareToken));
  assert.equal(Buffer.from(content, 'base64').toString().split('\n').length, 2);
  assert.ok(!Buffer.from(content, 'base64').toString().includes('192.0.2.90'));
  assert.equal(await subscriptions.generateHomeProxyContent(created.token), await subscriptions.generateHomeProxyContentByShareToken(share.shareToken));
  const shared = await subscriptions.findSharedWith('owner');
  assert.ok(!JSON.stringify(shared).includes('192.0.2.90'));
  await assert.rejects(subscriptions.update(created.id, 'foreign', undefined, 'owner'), /not found/);
  await assert.rejects(subscriptions.update(created.id, undefined, [], 'cf-owner'), /1-20 managed nodes/);
  await subscriptions.update(created.id, undefined, undefined, 'cf-owner', undefined, { cfPreferredIps: [] });
  const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(updated.token, created.token);
  assert.equal(updated.cfOnly, true);
  assert.equal(Buffer.from(await subscriptions.generateContent(updated.token), 'base64').toString().split('\n').length, 1);
  assert.equal((await prisma.subscriptionShare.findUniqueOrThrow({ where: { id: share.id } })).shareToken, share.shareToken);
  await subscriptions.update(created.id, undefined, undefined, 'cf-owner', undefined, { cfAuto: true });
  const probe = { id: 'fixture', url: 'https://probe.example.com', tokenEnv: 'CF_FIXTURE_TOKEN', carrier: 'TELECOM', region: 'fixture-city',
    expectedEgressIp: '192.0.2.1', verifiedAt: new Date().toISOString() };
  const oldRegistry = process.env.CF_OPTIMIZATION_PROBES;
  const oldToken = process.env.CF_FIXTURE_TOKEN;
  const oldDatabase = process.env.DATABASE_URL;
  try {
    process.env.CF_OPTIMIZATION_PROBES = JSON.stringify([probe]); process.env.CF_FIXTURE_TOKEN = 'f'.repeat(32);
    const current = await prisma.node.findUniqueOrThrow({ where: { id: 'cf-node' } });
    const observations = [{ ip: '104.16.0.1', latency: 50, passed: 2, failed: 0, checkedAt: Date.now() }];
    await prisma.cfOptimization.create({ data: { nodeId: current.id, probeId: probe.id,
      fingerprint: fingerprint([nodeFingerprint(current), fingerprint([probe, fingerprint('f'.repeat(32))])]), carrier: 'TELECOM', region: probe.region,
      observations, published: observations, previous: [{ ...observations[0], ip: '104.16.0.3' }], checkedAt: new Date(), discoveredAt: new Date() } });
    const ownerProvider = await subscriptions.generateCfProvider({ token: updated.token }, current.id);
    assert.equal(ownerProvider, await subscriptions.generateCfProvider({ shareToken: share.shareToken }, current.id));
    assert.ok(ownerProvider.includes('TELECOM')); assert.ok(!ownerProvider.includes('192.0.2.90'));
    const withDns = cf.defaultIp;
    try {
      cf.defaultIp = async () => null;
      await prisma.cfOptimization.updateMany({ where: { nodeId: current.id }, data: { published: [] } });
      assert.equal(await subscriptions.generateCfProvider({ token: updated.token }, current.id), buildCfUnavailableProvider(current.id));
      assert.equal(await subscriptions.generateCfProvider({ shareToken: share.shareToken }, current.id), buildCfUnavailableProvider(current.id));
      await assert.rejects(subscriptions.generateClashContent(updated.token), /direct fallback is forbidden/);
      await assert.rejects(subscriptions.generateCfProvider({ token: updated.token }, 'unknown'), /not available/);
    } finally {
      cf.defaultIp = withDns;
      await prisma.cfOptimization.updateMany({ where: { nodeId: current.id }, data: { published: observations } });
    }
    await assert.rejects(subscriptions.generateCfProvider({ token: original.token }, current.id), /not available/);
    const sharedClash = (await subscriptions.generateClashContentByShareToken(share.shareToken)).content;
    assert.ok(sharedClash.includes(`/share/${share.shareToken}/cf-provider/cf-node`));
    assert.ok(!sharedClash.includes(updated.token));
    await assert.rejects(optimizer.status(current.id, 'owner'), /not found/);
    assert.deepEqual((await optimizer.status(current.id, 'cf-owner')).missingCarriers, ['UNICOM', 'MOBILE']);
    process.env.DATABASE_URL = databaseUrl;
    const budgetTime = Date.parse('2026-10-31T00:00:00Z');
    const secondOptimizer = new CfOptimizationService(prisma, nodes, cf);
    const reservations = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? optimizer : secondOptimizer).reserveMonthlyBatch(budgetTime, 3)));
    assert.equal(reservations.filter(Boolean).length, 3);
    assert.deepEqual((await prisma.cfOptimizationState.findUniqueOrThrow({ where: { key: 'monthly:2026-10' } })).value, { batches: 3 });
    assert.equal(await secondOptimizer.reserveMonthlyBatch(Date.parse('2026-11-01T00:00:00Z'), 3), true);
    await optimizer.rollback(current.id, 'cf-owner');
    assert.equal((await optimizer.status(current.id, 'cf-owner')).paused, true);
    assert.ok((await subscriptions.generateCfProvider({ token: updated.token }, current.id)).includes('104.16.0.3'));
    await optimizer.resume(current.id, 'cf-owner');
    assert.equal((await optimizer.status(current.id, 'cf-owner')).paused, false);
    await prisma.cfOptimization.updateMany({ where: { nodeId: current.id }, data: {
      previous: [{ ...observations[0], checkedAt: Date.now() - 25 * 3600_000 }],
    } });
    await assert.rejects(optimizer.rollback(current.id, 'cf-owner'), /No safe previous/);
    assert.equal((await optimizer.status(current.id, 'cf-owner')).paused, false);
    await subscriptions.removeShare(created.id, 'owner', 'cf-owner');
    await assert.rejects(subscriptions.generateCfProvider({ shareToken: share.shareToken }, current.id), /not found/);
    const rotated = await subscriptions.refreshToken(created.id, 'cf-owner');
    await assert.rejects(subscriptions.generateCfProvider({ token: updated.token }, current.id), /not found/);
    updated.token = rotated.token;
  } finally {
    if (oldRegistry === undefined) delete process.env.CF_OPTIMIZATION_PROBES; else process.env.CF_OPTIMIZATION_PROBES = oldRegistry;
    if (oldToken === undefined) delete process.env.CF_FIXTURE_TOKEN; else process.env.CF_FIXTURE_TOKEN = oldToken;
    if (oldDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabase;
  }
  await prisma.node.update({ where: { id: 'cf-node' }, data: { enabled: false } });
  assert.equal(await subscriptions.generateCfProvider({ token: updated.token }, 'cf-node'), buildCfUnavailableProvider('cf-node'));
  await assert.rejects(subscriptions.generateHomeProxyContent(updated.token), /direct fallback is forbidden/);
  await prisma.node.delete({ where: { id: 'cf-node' } });
  assert.equal(await prisma.cfOptimization.count(), 0);
  await assert.rejects(subscriptions.generateClashContent(updated.token), /direct fallback is forbidden/);
  assert.equal(await prisma.configSnapshot.count(), resourceCount);
  assert.equal(await prisma.resourceCleanup.count(), cleanupCount);
  assert.equal(await prisma.node.count(), nodeCount);
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: 'sub' } })).token, original.token);
  process.stdout.write('CF access: additive defaults, persisted selection, tenant isolation, share parity, no remote resources, safe rollback PASS\n');
}
