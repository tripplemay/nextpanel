import { createHash } from 'crypto';
import { UsageProvisioner } from './usage-provisioner.service';
import { generateXrayConfig } from '../nodes/config/xray-config';
import { usageConfig } from './usage-config';
import { uploadText } from '../nodes/ssh/ssh.util';
import { remoteExec } from '../resources/remote-exec';

jest.mock('../common/database/advisory-lock', () => ({ withPostgresAdvisoryLocks: (_keys: string[], work: () => unknown) => work() }));
jest.mock('../nodes/ssh/ssh.util', () => ({ uploadText: jest.fn() }));
jest.mock('../resources/remote-exec', () => ({ remoteExec: jest.fn() }));

const fixtureNode = { id: 'n', userId: 'owner', serverId: 's', protocol: 'VLESS', implementation: 'XRAY', transport: 'WS', tls: 'TLS',
  cfDnsRecordId: 'record', domain: 'cdn.example.com', statsPort: 20443, listenPort: 443, enabled: true, status: 'RUNNING',
  server: { id: 's', retiredAt: null, status: 'ONLINE' }, usageState: { preparedAt: new Date() } };

function fixture(prepared = true) {
  const node = { ...fixtureNode, usageState: { preparedAt: prepared ? new Date() : null } };
  const original = generateXrayConfig(node, { uuid: 'legacy' });
  const config = prepared ? usageConfig(original, 'n', 20443, []).config : original;
  const runtime = new Map([['np-legacy', 'legacy']]);
  const calls: string[] = [];
  const files = new Map<string, string>();
  let failAdd = false; let failRestart = false;
  const prisma = {
    node: { findFirst: jest.fn().mockResolvedValue(node) },
    subscription: { count: jest.fn().mockResolvedValue(1) },
    usageCredential: { findMany: jest.fn().mockResolvedValue([{ id: 'fixture', uuidEnc: 'new', revokedAt: null }]), updateMany: jest.fn() },
    usageNode: { update: jest.fn(), upsert: jest.fn() },
    configSnapshot: { findFirst: jest.fn().mockResolvedValue({ version: 1 }), create: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(work => work(prisma));
  const ssh = { dispose: jest.fn() };
  const rollback = jest.fn();
  const resources = { connect: jest.fn().mockResolvedValue(ssh),
    assertUnchangedDeployment: jest.fn().mockResolvedValue(createHash('sha256').update(config).digest('hex')),
    registerDeployment: jest.fn().mockResolvedValue({ rollback }) };
  const usage = { enabled: () => true, revokeInvalidGrants: jest.fn() };
  const crypto = { decrypt: (v: string) => v, encrypt: (v: string) => `encrypted:${v}` };
  (uploadText as jest.Mock).mockImplementation((_ssh, content, path) => files.set(path, content));
  (remoteExec as jest.Mock).mockImplementation(async (_ssh, command: string) => {
    calls.push(command);
    if (command.startsWith('head ')) return { code: 0, stdout: config };
    if (command.includes('inbounduser')) return { code: 0, stdout: JSON.stringify({ users: [...runtime].map(([email, id]) => ({ email, account: { id } })) }) };
    if (command.includes(' api adu ') && !failAdd) runtime.set('np-usage-fixture', 'new');
    if (command.startsWith('systemctl restart ')) { if (failRestart) return { code: 1, stdout: '' }; runtime.set('np-usage-fixture', 'new'); }
    return { code: 0, stdout: '' };
  });
  // Deliberately small mocks: no real SSH, DNS, or production database access.
  const service = new UsageProvisioner(prisma as never, crypto as never, resources as never, usage as never);
  return { service, prisma, node, resources, rollback, runtime, files, calls, ssh, failAdd: () => { failAdd = true; }, failRestart: () => { failRestart = true; } };
}

describe('usage provisioner publication gate', () => {
  beforeEach(() => jest.clearAllMocks());
  it('initializes a newly added protected node without toggling its observed subscription', async () => {
    const f = fixture(false);
    f.prisma.node.findFirst.mockResolvedValue({ ...f.node, usageState: null });
    await expect(f.service.sync('n', 'owner', true)).resolves.toMatchObject({ prepared: true, restarted: true });
    expect(f.prisma.usageNode.upsert).toHaveBeenCalledWith({ where: { nodeId: 'n' }, create: { nodeId: 'n' }, update: {} });
    expect(f.prisma.subscription.count).toHaveBeenCalledWith({ where: { ownerId: 'owner', usageEnabled: true,
      nodes: { some: { nodeId: 'n' } }, OR: [{ cfOnly: true }, { cfProtectedNodeIds: { has: 'n' } }] } });
  });
  it('does not initialize an unobserved node or bypass restart consent for a newly added node', async () => {
    const f = fixture(false);
    f.prisma.node.findFirst.mockResolvedValue({ ...f.node, usageState: null });
    f.prisma.subscription.count.mockResolvedValue(0);
    await expect(f.service.sync('n', 'owner', true)).rejects.toThrow('not in an observed subscription');
    expect(f.prisma.usageNode.upsert).not.toHaveBeenCalled();
    expect(f.resources.connect).not.toHaveBeenCalled();
    const g = fixture(false);
    g.prisma.node.findFirst.mockResolvedValue({ ...g.node, usageState: null });
    await expect(g.service.sync('n', 'owner', false)).rejects.toThrow('PREPARATION_REQUIRED');
    expect(uploadText).not.toHaveBeenCalled();
  });
  it('persists, verifies exact runtime UUID, then marks credentials ready without restarting', async () => {
    const f = fixture();
    const result = await f.service.sync('n', 'owner', false);
    expect(result).toMatchObject({ prepared: true, installed: 1, restarted: false });
    expect(f.calls.some(c => c.includes('systemctl restart'))).toBe(false);
    expect(f.resources.registerDeployment).toHaveBeenCalledTimes(1);
    expect(f.prisma.usageCredential.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { installedAt: expect.any(Date) } }));
    expect(f.calls.findIndex(c => c.includes('mv -f'))).toBeLessThan(f.calls.findIndex(c => c.includes(' api adu ')));
    expect(f.ssh.dispose).toHaveBeenCalled();
  });
  it('does not publish when an add command exits zero but adds no users', async () => {
    const f = fixture(); f.failAdd();
    await expect(f.service.sync('n', 'owner', false)).rejects.toThrow('VERIFICATION_FAILED');
    expect(f.prisma.usageCredential.updateMany).not.toHaveBeenCalled();
    expect(f.prisma.usageNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ error: 'VERIFICATION_FAILED' }) }));
  });
  it('refuses mismatched identities and configuration drift before any writes', async () => {
    const f = fixture(); f.runtime.set('np-usage-fixture', 'foreign');
    await expect(f.service.sync('n', 'owner', false)).rejects.toThrow('RUNTIME_IDENTITY_CONFLICT');
    expect(uploadText).not.toHaveBeenCalled();
    const g = fixture(); g.resources.assertUnchangedDeployment.mockRejectedValue(new Error('drift'));
    await expect(g.service.sync('n', 'owner', false)).rejects.toThrow('SYNC_FAILED');
    expect(uploadText).not.toHaveBeenCalled();
  });
  it('requires explicit restart consent on the first preparation', async () => {
    const f = fixture(false);
    await expect(f.service.sync('n', 'owner', false)).rejects.toThrow('PREPARATION_REQUIRED');
    expect(uploadText).not.toHaveBeenCalled();
    expect(f.calls.some(c => c.includes('systemctl restart'))).toBe(false);
  });
  it('restores the original configuration and ownership after an initial restart fails', async () => {
    const f = fixture(false); f.failRestart();
    await expect(f.service.sync('n', 'owner', true)).rejects.toThrow('RESTART_FAILED');
    expect(f.rollback).toHaveBeenCalledTimes(1);
    expect(f.calls.some(c => c.includes('systemctl is-active --quiet'))).toBe(true);
    expect(f.prisma.usageCredential.updateMany).not.toHaveBeenCalled();
  });
  it('reports unverified rollback explicitly and clears the publication gate', async () => {
    const f = fixture(false); f.failRestart(); f.rollback.mockRejectedValue(new Error('restore failed'));
    await expect(f.service.sync('n', 'owner', true)).rejects.toThrow('rollback needs operator review');
    expect(f.prisma.usageNode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ error: 'ROLLBACK_FAILED', preparedAt: null }) }));
    expect(f.prisma.usageCredential.updateMany).not.toHaveBeenCalled();
  });
  it('does not mark revocation complete when the remote removal silently fails', async () => {
    const f = fixture(); f.runtime.set('np-usage-revoked', 'old');
    f.prisma.usageCredential.findMany.mockResolvedValue([{ id: 'revoked', uuidEnc: 'old', revokedAt: new Date() }]);
    await expect(f.service.sync('n', 'owner', false)).rejects.toThrow('VERIFICATION_FAILED');
    expect(f.calls.some(c => c.includes(' api rmu '))).toBe(true);
    expect(f.prisma.usageCredential.updateMany).not.toHaveBeenCalled();
    expect(f.runtime.get('np-legacy')).toBe('legacy');
  });
  it('does not connect to SSH for an unauthorized node', async () => {
    const f = fixture(); f.prisma.node.findFirst.mockResolvedValue(null);
    await expect(f.service.sync('n', 'foreign', true)).rejects.toThrow();
    expect(f.resources.connect).not.toHaveBeenCalled();
  });
});
