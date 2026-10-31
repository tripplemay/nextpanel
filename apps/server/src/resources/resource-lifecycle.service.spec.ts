import { CleanupBlockedError, cleanupPayload, hashConfig, ResourceLifecycleService } from './resource-lifecycle.service';
import { resourcePaths } from './remote-inventory';

jest.mock('../common/database/advisory-lock', () => ({ withPostgresAdvisoryLocks: jest.fn(async (_keys, work) => work()) }));

describe('resource lifecycle safety', () => {
  const hostId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const paths = resourcePaths('node', 'ENTRY');
  const server = { id: 'host', userId: 'owner', remoteHostId: hostId, sshAuthEnc: 'encrypted' };
  const job = { id: 'job', serverId: 'host', nodeId: 'node', role: 'ENTRY', panelInstanceId: 'panel', remoteHostId: hostId, expectedConfigHashEnc: hashConfig('approved') };
  const manifest = { version: 1, hostId, panelInstanceId: 'panel', serverId: 'host', nodeId: 'node', role: 'ENTRY', configHash: hashConfig('approved') };
  let config: string | null;
  let raw: string | null;
  let fragment: string;
  const prisma = {
    panelIdentity: { upsert: jest.fn() },
    server: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    node: { findMany: jest.fn(), count: jest.fn() },
    resourceCleanup: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    resourceFinding: { upsert: jest.fn(), updateMany: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  };
  const crypto = { decrypt: jest.fn(x => x) };
  const ssh = { execCommand: jest.fn(), dispose: jest.fn() };
  let service: ResourceLifecycleService;
  beforeEach(() => {
    jest.clearAllMocks();
    config = job.expectedConfigHashEnc;
    raw = JSON.stringify(manifest);
    fragment = paths.unit;
    prisma.panelIdentity.upsert.mockResolvedValue({ instanceId: 'panel' });
    prisma.server.findUniqueOrThrow.mockResolvedValue(server);
    prisma.server.findFirst.mockResolvedValue(server);
    prisma.server.findMany.mockResolvedValue([server]);
    prisma.node.findMany.mockResolvedValue([]);
    prisma.node.count.mockResolvedValue(0);
    prisma.resourceCleanup.findMany.mockResolvedValue([]);
    prisma.resourceCleanup.count.mockResolvedValue(0);
    prisma.resourceFinding.findMany.mockResolvedValue([]);
    prisma.resourceFinding.count.mockResolvedValue(0);
    ssh.execCommand.mockImplementation(async (command: string) => {
      if (command.includes('cat /etc/nextpanel/host-id')) return { code: 0, stdout: hostId };
      if (command.includes('sha256sum')) return config ? { code: 0, stdout: `${config}  ${paths.config}` } : { code: 3, stdout: '' };
      if (command.includes('head -c')) return raw ? { code: 0, stdout: raw } : { code: 3, stdout: '' };
      if (command.includes('FragmentPath')) return { code: 0, stdout: fragment };
      if (command.includes('ExecStart')) return { code: 0, stdout: `{ path=/usr/local/bin/xray ; argv[]=/usr/local/bin/xray run -config ${paths.config} ; }` };
      if (command.includes('ss -H')) return { code: 0, stdout: 'NEXT_PANEL_SOCKETS_V1\nNEXT_PANEL_SOCKETS_END\n' };
      if (command.includes('list-unit-files')) return { code: 0, stdout: 'NEXT_PANEL_UNITS_END\n' };
      return { code: 0, stdout: '' };
    });
    service = new ResourceLifecycleService(prisma as any, crypto as any);
  });

  it.each([
    { port: 0 }, { port: 65536 }, { statsPort: 1.5 }, { entryIp: '$(rm -rf /)' }, { protocols: ['sctp'] }, { cfRecordId: '../zones' },
  ])('rejects malformed persisted cleanup input: %j', payload => {
    expect(() => cleanupPayload(payload)).toThrow(CleanupBlockedError);
  });

  it('accepts a matching deployment and persists identity before destructive work', async () => {
    expect(await service.prepareCleanup(ssh as any, server as any, job as any)).toEqual(paths);
    expect(prisma.resourceCleanup.update).toHaveBeenCalledWith({ where: { id: 'job' }, data: { remoteHostId: hostId } });
    expect(ssh.execCommand.mock.calls.every(([cmd]) => !/systemctl (stop|disable)|rm -/.test(cmd))).toBe(true);
  });

  it.each(['panelInstanceId', 'hostId', 'serverId', 'nodeId', 'role'])('blocks a manifest with foreign %s', async key => {
    raw = JSON.stringify({ ...manifest, [key]: 'foreign' });
    await expect(service.prepareCleanup(ssh as any, server as any, job as any)).rejects.toThrow('Ownership mismatch');
    expect(prisma.resourceCleanup.update).not.toHaveBeenCalled();
  });

  it('blocks an IP reassigned to a different host', async () => {
    await expect(service.prepareCleanup(ssh as any, server as any, { ...job, remoteHostId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' } as any)).rejects.toThrow('host identity');
  });

  it('blocks changed config, foreign unit paths and missing approved config', async () => {
    config = hashConfig('changed');
    await expect(service.prepareCleanup(ssh as any, server as any, job as any)).rejects.toThrow('config changed');
    config = job.expectedConfigHashEnc;
    fragment = '/usr/lib/systemd/system/foreign.service';
    await expect(service.prepareCleanup(ssh as any, server as any, job as any)).rejects.toThrow('Unit path');
    fragment = paths.unit;
    config = null;
    await expect(service.prepareCleanup(ssh as any, server as any, job as any)).rejects.toThrow('without a verifiable config');
  });

  it('supports idempotent retry after owned unit/config were already removed', async () => {
    fragment = '';
    config = null;
    expect(await service.prepareCleanup(ssh as any, server as any, job as any)).toEqual(paths);
  });

  it('does not infer ownership from an untracked config filename', async () => {
    fragment = '';
    raw = null;
    await expect(service.prepareCleanup(ssh as any, server as any, job as any)).rejects.toThrow('Unattributed config');
  });

  it('adopts a legacy host only with matching approved config and exact managed unit', async () => {
    raw = null;
    jest.spyOn(service, 'remoteHost').mockResolvedValue(null);
    const adopt = jest.spyOn(service, 'ensureHostIdentity').mockResolvedValue(hostId);
    await service.prepareCleanup(ssh as any, { ...server, remoteHostId: null } as any, { ...job, remoteHostId: null } as any);
    expect(adopt).toHaveBeenCalledTimes(1);
    config = null;
    fragment = '';
    await expect(service.prepareCleanup(ssh as any, server as any, job as any)).rejects.toThrow('Legacy host identity');
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  it('reserves ports belonging to pending jobs even when no process is listening', async () => {
    jest.spyOn(service, 'connect').mockResolvedValue(ssh as any);
    prisma.resourceCleanup.findMany.mockImplementation(async ({ select }) => select.payload
      ? [{ payload: { port: 15000, statsPort: 61000 } }] : []);
    expect(await service.unavailablePorts('host')).toEqual(new Set([15000, 61000]));
    expect(ssh.dispose).toHaveBeenCalled();
  });

  it('reports unknown services without issuing SSH commands; partial heartbeats never resolve absence', async () => {
    prisma.node.findMany.mockResolvedValue([{ id: 'known', serverId: 'host', exitServerId: null }]);
    prisma.resourceCleanup.findMany.mockResolvedValue([{ nodeId: 'deleting', role: 'EXIT' }]);
    await service.observeServices(server as any, ['nextpanel-known', 'nextpanel-chain-deleting', 'nextpanel-old', 'nextpanel-agent']);
    expect(prisma.resourceFinding.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.resourceFinding.upsert.mock.calls[0][0].create.serviceName).toBe('nextpanel-old');
    expect(prisma.resourceFinding.updateMany).not.toHaveBeenCalled();
    expect(ssh.execCommand).not.toHaveBeenCalled();
    await service.observeServices(server as any, [], true);
    expect(prisma.resourceFinding.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ serverId: 'host', serviceName: { notIn: [] } }) }));
  });

  it('throttles repeated heartbeat inventory but not explicit complete scans', async () => {
    await service.observeServices(server as any, ['nextpanel-old']);
    await service.observeServices(server as any, ['nextpanel-old']);
    expect(prisma.resourceFinding.upsert).toHaveBeenCalledTimes(1);
    await service.observeServices(server as any, ['nextpanel-old'], true);
    expect(prisma.resourceFinding.upsert).toHaveBeenCalledTimes(2);
  });

  it('keeps credentials while any task, desired node or unknown service still needs review', async () => {
    jest.spyOn(service, 'scan').mockResolvedValue({ tasks: [], findings: [], retirements: [] });
    prisma.resourceCleanup.count.mockResolvedValueOnce(1);
    await service.finishRetiredServers();
    prisma.node.count.mockResolvedValueOnce(1);
    await service.finishRetiredServers();
    prisma.resourceFinding.count.mockResolvedValueOnce(1);
    await service.finishRetiredServers();
    expect(prisma.server.deleteMany).not.toHaveBeenCalled();
    (service as any).finalInventoryAt.clear();
    await service.finishRetiredServers();
    expect(prisma.server.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('retains credentials if the final complete inventory cannot be obtained', async () => {
    jest.spyOn(service, 'scan').mockRejectedValue(new Error('SSH offline'));
    await service.finishRetiredServers();
    expect(prisma.server.deleteMany).not.toHaveBeenCalled();
    expect(prisma.server.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { deleteError: 'SSH offline' } }));
  });

  it('owner-scopes scan, list and retry without exposing task payloads', async () => {
    prisma.server.findFirst.mockResolvedValue(null);
    await expect(service.scan('host', 'foreign')).rejects.toThrow('not found');
    expect(ssh.execCommand).not.toHaveBeenCalled();
    await service.list('owner');
    expect(prisma.resourceCleanup.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { ownerId: 'owner', state: { not: 'DONE' } }, select: expect.not.objectContaining({ payload: true }) }));
    prisma.resourceCleanup.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.retry('job', 'foreign')).rejects.toThrow('not found');
    expect(prisma.resourceCleanup.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job', ownerId: 'foreign', state: { in: ['PENDING', 'BLOCKED'] } } }));
  });
});
