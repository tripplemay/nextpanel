import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function verifySystemInfo({ prisma, require, root }) {
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { SystemInfoService } = require(join(root, 'apps/server/src/agent/system-info.service.ts'));
  const { AgentController } = require(join(root, 'apps/server/src/agent/agent.controller.ts'));
  const { AgentService } = require(join(root, 'apps/server/src/agent/agent.service.ts'));
  const { ServersService } = require(join(root, 'apps/server/src/servers/servers.service.ts'));
  const service = new SystemInfoService(prisma);
  const servers = new ServersService(prisma);
  const server = await prisma.server.create({ data: {
    userId: 'owner', name: 'Inventory fixture', region: 'fixture', provider: 'fixture',
    ip: '192.0.2.101', sshAuthEnc: '', agentToken: 'hardware-fixture', tags: [], autoTags: [],
  } });
  const module = await Test.createTestingModule({
    controllers: [AgentController],
    providers: [{ provide: SystemInfoService, useValue: service }, { provide: AgentService, useValue: {} }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}/api/agent/system-info`;
  const post = payload => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const time = offset => new Date(Date.now() - 60000 + offset).toISOString();
  const first = { agentToken: server.agentToken, schemaVersion: 1, agentVersion: '1.9.0', collectedAt: time(0),
    values: { cpuModel: 'Fixture CPU', cpuLogicalCores: 2, architecture: 'amd64', memoryTotalBytes: 4 * 1024 ** 3, rootTotalBytes: 80 * 1024 ** 3 } };
  try {
    assert.equal((await post({ ...first, agentToken: 'foreign' })).status, 401);
    assert.equal((await post({ ...first, serverId: 'srv' })).status, 400);
    assert.equal((await post({ ...first, values: { rootTotalBytes: -1 } })).status, 400);
    assert.equal((await post(first)).status, 201);
    let detail = await servers.findOne(server.id, 'owner');
    assert.equal(detail.credentialsDestroyed, true, 'inventory must work without SSH credentials');
    assert.equal(detail.systemInfo.fields.cpuModel.value, 'Fixture CPU');
    assert.equal(detail.status, server.status, 'inventory cannot mark servers online');
    assert.equal(detail.lastSeenAt, null, 'inventory cannot refresh heartbeat time');
    assert.equal(detail.cpuUsage, null);
    await assert.rejects(servers.findOne(server.id, 'foreign'), error => error.getStatus() === 404);
    assert.ok((await servers.findAll('owner')).every(row => !('systemInfo' in row)), 'inventory is detail-only');

    const partial = { ...first, collectedAt: time(1000), values: { cpuLogicalCores: 4 } };
    assert.equal((await post(partial)).status, 201);
    detail = await servers.findOne(server.id, 'owner');
    assert.equal(detail.systemInfo.fields.cpuLogicalCores.value, 4);
    assert.equal(detail.systemInfo.fields.memoryTotalBytes.collectedAt, first.collectedAt);
    assert.ok(detail.systemInfo.missingFields.includes('memoryTotalBytes'));
    const receipt = detail.systemInfo.receivedAt.toISOString();
    assert.equal((await post(first)).status, 201);
    assert.equal((await servers.findOne(server.id, 'owner')).systemInfo.receivedAt.toISOString(), receipt);

    await Promise.all([2, 4, 3].map(n => service.receive({ ...first, collectedAt: time(n * 1000), values: { cpuLogicalCores: n } })));
    assert.equal((await servers.findOne(server.id, 'owner')).systemInfo.fields.cpuLogicalCores.value, 4, 'late old report must not replace newer snapshot');
    await prisma.server.update({ where: { id: server.id }, data: { status: 'OFFLINE' } });
    assert.ok((await servers.findOne(server.id, 'owner')).systemInfo, 'offline retains inventory');
    await prisma.server.update({ where: { id: server.id }, data: { status: 'DELETING' } });
    assert.equal((await service.receive({ ...first, collectedAt: time(5000) })).ignored, true);
    await prisma.server.delete({ where: { id: server.id } });
    assert.equal(await prisma.serverSystemInfo.count({ where: { serverId: server.id } }), 0, 'delete cascades inventory');
    assert.equal((await post(first)).status, 401, 'deleted token cannot recreate inventory');
    console.log('System inventory: real HTTP validation, token ownership, migration, partial freshness, ordering, isolation and cascade PASS');
  } finally {
    await app.close();
    await prisma.server.deleteMany({ where: { id: server.id } });
  }
}
