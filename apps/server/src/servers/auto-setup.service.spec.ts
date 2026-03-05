import { NotFoundException } from '@nestjs/common';
import { firstValueFrom, toArray } from 'rxjs';
import { AutoSetupService } from './auto-setup.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import * as sshUtil from '../nodes/ssh/ssh.util';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSsh = {
  dispose: jest.fn(),
};

jest.mock('../nodes/ssh/ssh.util', () => ({
  connectSsh: jest.fn(),
}));
const mockConnectSsh = sshUtil.connectSsh as jest.Mock;

const mockPrisma = {
  server: { findUnique: jest.fn() },
} as unknown as PrismaService;

const mockCrypto = {
  decrypt: jest.fn((s: string) => `dec:${s}`),
} as unknown as CryptoService;

const fakeServer = {
  id: 'srv-1', name: 'TestServer', ip: '1.2.3.4',
  sshPort: 22, sshUser: 'root', sshAuthType: 'KEY', sshAuthEnc: 'enc:key',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function collectEvents(svc: AutoSetupService, serverId: string) {
  return firstValueFrom(svc.setupStream(serverId, [], 'actor-1').pipe(toArray()));
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AutoSetupService', () => {
  let svc: AutoSetupService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new AutoSetupService(mockPrisma, mockCrypto);
  });

  it('emits done=false when server is not found', async () => {
    (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

    const events = await collectEvents(svc, 'missing');
    const doneEvent = events.find((e) => (e.data as any).done);

    expect(doneEvent?.data).toMatchObject({ done: true, success: false });
  });

  it('emits done=true and disposes SSH on success', async () => {
    (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
    mockConnectSsh.mockResolvedValue(mockSsh);

    const events = await collectEvents(svc, 'srv-1');
    const logs = events.filter((e) => (e.data as any).log).map((e) => (e.data as any).log as string);
    const doneEvent = events.find((e) => (e.data as any).done);

    expect(mockConnectSsh).toHaveBeenCalledWith(
      expect.objectContaining({ host: '1.2.3.4', port: 22, username: 'root' }),
    );
    expect(mockSsh.dispose).toHaveBeenCalled();
    expect(doneEvent?.data).toMatchObject({ done: true, success: true });
    expect(logs.some((l) => l.includes('自动配置完成'))).toBe(true);
  });

  it('decrypts SSH auth before connecting', async () => {
    (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
    mockConnectSsh.mockResolvedValue(mockSsh);

    await collectEvents(svc, 'srv-1');

    expect(mockCrypto.decrypt).toHaveBeenCalledWith('enc:key');
    expect(mockConnectSsh).toHaveBeenCalledWith(
      expect.objectContaining({ auth: 'dec:enc:key' }),
    );
  });

  it('emits done=false and error log when SSH fails', async () => {
    (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
    mockConnectSsh.mockRejectedValue(new Error('connection refused'));

    const events = await collectEvents(svc, 'srv-1');
    const logs = events.filter((e) => (e.data as any).log).map((e) => (e.data as any).log as string);
    const doneEvent = events.find((e) => (e.data as any).done);

    expect(doneEvent?.data).toMatchObject({ done: true, success: false });
    expect(logs.some((l) => l.includes('[ERROR]') && l.includes('connection refused'))).toBe(true);
  });

  it('ignores _templateIds (no-op)', async () => {
    (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
    mockConnectSsh.mockResolvedValue(mockSsh);

    // Even with templateIds provided, should still succeed and not call any template logic
    const events = await firstValueFrom(
      svc.setupStream('srv-1', ['tpl-1', 'tpl-2'], 'actor').pipe(toArray()),
    );
    const doneEvent = events.find((e) => (e.data as any).done);
    expect(doneEvent?.data).toMatchObject({ done: true, success: true });
  });
});
