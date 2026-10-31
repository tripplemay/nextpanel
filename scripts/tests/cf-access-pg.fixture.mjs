import assert from 'node:assert/strict';

// Called exclusively inside database-integration.mjs's disposable local cluster.
export async function verifyCfAccess({ prisma, cipher, require, root }) {
  const { CfAccessService } = require(`${root}/apps/server/src/subscriptions/cf-access.service.ts`);
  const { SubscriptionsService } = require(`${root}/apps/server/src/subscriptions/subscriptions.service.ts`);
  const original = await prisma.subscription.findUniqueOrThrow({ where: { id: 'sub' } });
  assert.equal(original.cfOnly, false);
  assert.deepEqual(original.cfPreferredIps, []);
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
  const subscriptions = new SubscriptionsService(prisma, nodes, { get: () => 'https://panel.example.com' }, cipher, cf);
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
  await prisma.node.update({ where: { id: 'cf-node' }, data: { enabled: false } });
  await assert.rejects(subscriptions.generateHomeProxyContent(updated.token), /direct fallback is forbidden/);
  await prisma.node.delete({ where: { id: 'cf-node' } });
  await assert.rejects(subscriptions.generateClashContent(updated.token), /direct fallback is forbidden/);
  assert.equal(await prisma.configSnapshot.count(), resourceCount);
  assert.equal(await prisma.resourceCleanup.count(), cleanupCount);
  assert.equal(await prisma.node.count(), nodeCount);
  assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: 'sub' } })).token, original.token);
  process.stdout.write('CF access: additive defaults, persisted selection, tenant isolation, share parity, no remote resources, safe rollback PASS\n');
}
