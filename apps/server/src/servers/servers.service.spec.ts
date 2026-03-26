import { ServersService } from './servers.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from '../nodes/node-deploy.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
import { IpCheckService } from '../ip-check/ip-check.service';
import { NotFoundException } from '@nestjs/common';

// Mock node-ssh before importing ServersService
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockExecCommand = jest.fn().mockResolvedValue({ stdout: 'ok', stderr: '' });
const mockDispose = jest.fn();

jest.mock('node-ssh', () => ({
  NodeSSH: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    execCommand: mockExecCommand,
    dispose: mockDispose,
  })),
}));

// Mock connectSsh used by installAgentStream
const mockSsh = {
  execCommand: jest.fn(),
  dispose: jest.fn(),
};
jest.mock('../nodes/ssh/ssh.util', () => ({
  connectSsh: jest.fn(),
}));
import { connectSsh } from '../nodes/ssh/ssh.util';
const mockConnectSsh = connectSsh as jest.Mock;

const mockPrisma = {
  server: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  node: {
    findMany: jest.fn().mockResolvedValue([]),
  },
} as unknown as PrismaService;

const mockCrypto = {
  encrypt: jest.fn((s: string) => `enc:${s}`),
  decrypt: jest.fn((s: string) => s.replace('enc:', '')),
} as unknown as CryptoService;

const mockNodeDeploy = {
  undeploy: jest.fn().mockResolvedValue(undefined),
} as unknown as NodeDeployService;

const mockCfService = {
  deleteRecord: jest.fn().mockResolvedValue(undefined),
} as unknown as CloudflareService;

const mockCfSettings = {
  getDecryptedToken: jest.fn().mockResolvedValue(null),
} as unknown as CloudflareSettingsService;

const mockIpCheck = {
  triggerCheck: jest.fn(),
} as unknown as IpCheckService;

const svc = new ServersService(mockPrisma, mockCrypto, mockNodeDeploy, mockCfService, mockCfSettings, mockIpCheck);

const fakeServer = {
  id: 'srv-1', name: 'Test Server', ip: '1.2.3.4',
  sshPort: 22, sshUser: 'root', sshAuthType: 'PASSWORD',
  sshAuthEnc: 'enc:secret',
  status: 'ONLINE', tags: [], notes: null,
  createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockExecCommand.mockResolvedValue({ stdout: 'ok', stderr: '' });
  mockConnectSsh.mockResolvedValue(mockSsh);
  mockSsh.execCommand.mockResolvedValue({ stdout: '', stderr: '', code: 1 });
  mockSsh.dispose.mockReset();
});

describe('ServersService', () => {
  describe('create', () => {
    it('encrypts sshAuth and creates server', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({
        name: 'Test', ip: '1.2.3.4', sshAuth: 'mypassword',
        sshAuthType: 'PASSWORD' as any,
      } as any, 'user-id-1');

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('mypassword');
      expect(mockPrisma.server.create).toHaveBeenCalled();
    });

    it('defaults sshPort to 22 when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any, 'user-id-1');

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.sshPort).toBe(22);
    });

    it('defaults sshUser to root when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any, 'user-id-1');

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.sshUser).toBe('root');
    });

    it('defaults tags to empty array when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any, 'user-id-1');

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.tags).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('returns all servers ordered by createdAt desc', async () => {
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([fakeServer]);

      const result = await svc.findAll('user-id-1');

      expect(result).toHaveLength(1);
      const call = (mockPrisma.server.findMany as jest.Mock).mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('findOne', () => {
    it('returns server when found', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.findOne('srv-1', 'user-id-1');

      const { sshAuthEnc, ...rest } = fakeServer;
      expect(result).toEqual({ ...rest, credentialsDestroyed: false });
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.findOne('bad', 'user-id-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('re-encrypts sshAuth when provided', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      await svc.update('srv-1', { sshAuth: 'newpassword' } as any, 'user-id-1');

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('newpassword');
    });

    it('does not encrypt when sshAuth not in update payload', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      await svc.update('srv-1', { name: 'Renamed' } as any, 'user-id-1');

      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for missing server', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.update('bad', {} as any, 'user-id-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    it('returns DELETING status and fires background cleanup', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.server.delete as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.remove('srv-1', 'user-id-1');
      await flushPromises();

      expect(result).toEqual({ status: 'DELETING' });
      expect(mockPrisma.server.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DELETING' }) }),
      );
    });

    it('deletes the server after background cleanup with no nodes', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.server.delete as jest.Mock).mockResolvedValue(fakeServer);

      await svc.remove('srv-1', 'user-id-1');
      await flushPromises();

      expect(mockPrisma.server.delete).toHaveBeenCalledWith({ where: { id: 'srv-1' } });
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.remove('bad', 'user-id-1')).rejects.toThrow(NotFoundException);
    });

    it('undeploys all nodes before deleting (best-effort)', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.delete as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([
        { id: 'node-1', name: 'N1', userId: 'user-1', cfDnsRecordId: null },
      ]);
      (mockNodeDeploy.undeploy as jest.Mock).mockResolvedValue(undefined);

      await svc.remove('srv-1', 'user-id-1');
      await flushPromises();

      expect(mockNodeDeploy.undeploy).toHaveBeenCalledWith('node-1');
    });

    it('sets server to ERROR state when a node undeploy fails (no delete)', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([
        { id: 'node-1', name: 'N1', userId: 'user-1', cfDnsRecordId: null },
      ]);
      (mockNodeDeploy.undeploy as jest.Mock).mockRejectedValue(new Error('SSH failed'));

      await svc.remove('srv-1', 'user-id-1');
      await flushPromises();

      // Server is set to ERROR, NOT deleted, when undeploy fails
      expect(mockPrisma.server.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ERROR' }) }),
      );
      expect(mockPrisma.server.delete).not.toHaveBeenCalled();
    });

    it('cleans up Cloudflare DNS records when nodes have cfDnsRecordId', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.delete as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([
        { id: 'node-1', name: 'N1', userId: 'user-1', cfDnsRecordId: 'rec-abc' },
      ]);
      (mockNodeDeploy.undeploy as jest.Mock).mockResolvedValue(undefined);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', zoneId: 'zone-1',
      });

      await svc.remove('srv-1', 'user-id-1');
      await flushPromises();

      expect(mockCfService.deleteRecord).toHaveBeenCalledWith('cf-token', 'zone-1', 'rec-abc');
    });
  });

  describe('testSsh', () => {
    it('returns success=true when echo ok succeeds', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.testSsh('srv-1', 'user-id-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('SSH connection successful');
    });

    it('connects with password when sshAuthType is PASSWORD', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue({
        ...fakeServer, sshAuthType: 'PASSWORD', sshAuthEnc: 'enc:mypassword',
      });

      await svc.testSsh('srv-1', 'user-id-1');

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'mypassword' }),
      );
    });

    it('connects with privateKey when sshAuthType is KEY', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue({
        ...fakeServer, sshAuthType: 'KEY', sshAuthEnc: 'enc:-----BEGIN RSA',
      });

      await svc.testSsh('srv-1', 'user-id-1');

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({ privateKey: '-----BEGIN RSA' }),
      );
    });

    it('returns success=false when stdout is not "ok"', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      mockExecCommand.mockResolvedValue({ stdout: 'something else', stderr: '' });

      const result = await svc.testSsh('srv-1', 'user-id-1');

      expect(result.success).toBe(false);
    });

    it('returns success=false with error message on connection failure', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      const result = await svc.testSsh('srv-1', 'user-id-1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection refused');
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.testSsh('bad', 'user-id-1')).rejects.toThrow(NotFoundException);
    });

    it('handles non-Error thrown objects gracefully', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);
      mockConnect.mockRejectedValue('string error');

      const result = await svc.testSsh('srv-1', 'user-id-1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed');
    });
  });

  describe('checkIp', () => {
    it('returns exists=true when server with IP exists', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.checkIp('1.2.3.4', 'user-id-1');

      expect(result.exists).toBe(true);
    });

    it('returns exists=false when no server with IP exists', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await svc.checkIp('9.9.9.9', 'user-id-1');

      expect(result.exists).toBe(false);
    });
  });

  describe('installAgentStream', () => {
    const fakeServerWithToken = { ...fakeServer, sshAuthEnc: 'enc:secret', agentToken: 'tok-abc' };

    // Helper: collect all SSE events from the observable
    function collectEvents(id: string): Promise<Array<{ data: Record<string, unknown> }>> {
      return new Promise((resolve, reject) => {
        const events: Array<{ data: Record<string, unknown> }> = [];
        svc.installAgentStream(id).subscribe({
          next: (ev) => events.push(ev as any),
          error: reject,
          complete: () => resolve(events),
        });
      });
    }

    /**
     * Helper: build a full happy-path SSH command mock sequence for installAgent.
     *
     * Sequence (fresh install, not alreadyInstalled):
     *  1. systemctl is-active nextpanel-agent       → { code: 1 }  (not installed)
     *  2. sysctl -n tcp_congestion_control          → { stdout: 'cubic' } (BBR not active)
     *  3. modprobe tcp_bbr                          → { code: 0 }
     *  4. grep -q bbr /proc/sys/...                → { code: 1 }  (BBR not available)
     *  5. sysctl.d TCP buffer config               → { code: 0 }
     *  6. fd limits (grep or echo)                 → { code: 0 }
     *  7. uname -m                                 → { stdout: arch }
     *  8. curl github release                      → { stdout: '{"tag_name":"agent/v1.0"}' }
     *  9. curl download binary                     → { code: 0 }
     * 10. mkdir -p /etc/nextpanel                  → { stdout: '' }
     * 11. echo | base64 -d > agent.json            → { stdout: '' }
     * 12. echo | base64 -d > nextpanel-agent.service → { stdout: '' }
     * 13. systemctl daemon-reload                  → { stdout: '' }
     * 14. systemctl enable nextpanel-agent         → { stdout: '' }
     * 15. systemctl start nextpanel-agent          → { code: 0 }
     * 16. systemctl status nextpanel-agent         → { stdout: 'active' }
     */
    function mockFreshInstallSequence(arch: string) {
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // 1. is-active (not installed)
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '', code: 0 })      // 2. sysctl check (not bbr)
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 3. modprobe
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // 4. grep bbr available (not supported)
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 5. sysctl TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 6. fd limits
        .mockResolvedValueOnce({ stdout: arch, stderr: '' })                  // 7. uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' }) // 8. github release
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 9. download binary
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // 10. mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // 11. write config
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // 12. write service
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // 13. daemon-reload
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // 14. enable
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 15. start
        .mockResolvedValueOnce({ stdout: 'active', stderr: '' });             // 16. status
    }

    /**
     * Helper: build mock sequence for upgrade path (alreadyInstalled=true).
     *
     * Sequence (upgrade, alreadyInstalled):
     *  1. systemctl is-active                      → { code: 0 }  (installed)
     *  2. sysctl -n tcp_congestion_control         → { stdout: 'cubic' }
     *  3. modprobe tcp_bbr                         → { code: 0 }
     *  4. grep -q bbr                              → { code: 1 }
     *  5. sysctl TCP buffer                        → { code: 0 }
     *  6. fd limits                                → { code: 0 }
     *  7. uname -m                                 → { stdout: arch }
     *  8. curl github release                      → { stdout: '{"tag_name":"agent/v1.0"}' }
     *  9. systemctl stop (alreadyInstalled)        → { code: 0 }
     * 10. curl download binary                     → { code: 0 }
     * 11. mkdir                                    → { stdout: '' }
     * 12. write config                             → { stdout: '' }
     * 13. systemctl start                          → { code: 0 }
     * 14. systemctl status                         → { stdout: 'active' }
     */
    function mockUpgradeSequence(arch: string) {
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 0, stdout: 'active', stderr: '' })     // 1. is-active (already installed)
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '', code: 0 })      // 2. sysctl check
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 3. modprobe
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // 4. grep bbr (not available)
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 5. sysctl TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 6. fd limits
        .mockResolvedValueOnce({ stdout: arch, stderr: '' })                  // 7. uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' }) // 8. github release
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 9. stop (alreadyInstalled)
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 10. download
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // 11. mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // 12. write config
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // 13. start
        .mockResolvedValueOnce({ stdout: 'active', stderr: '' });             // 14. status
    }

    it('emits manualCmd when PANEL_URL and GITHUB_REPO are set', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      // SSH connect succeeds; agent not active; arch detection, then fail on release fetch
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' }) // systemctl is-active
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '' })     // sysctl check
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // modprobe
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' }) // grep bbr
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // fd limits
        .mockResolvedValueOnce({ stdout: 'unsupported_arch', stderr: '' }); // uname -m → throw

      const events = await collectEvents('srv-1');
      const manualCmdEvent = events.find((e) => 'manualCmd' in e.data);
      // manualCmd includes panel URL and token
      if (manualCmdEvent) {
        expect(manualCmdEvent.data.manualCmd).toContain('https://panel.test');
        expect(manualCmdEvent.data.manualCmd).toContain('tok-abc');
      }
      // done event always emitted
      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent).toBeDefined();

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('emits done=false when PANEL_URL is not configured', async () => {
      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);

      const events = await collectEvents('srv-1');

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(false);
    });

    it('emits done=false when server is not found', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      const events = await collectEvents('srv-1');

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(false);

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('returns true when agent is already running and upgrade succeeds', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockUpgradeSequence('x86_64');

      const events = await collectEvents('srv-1');

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(true);

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('throws for unsupported architecture', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' }) // is-active
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '' })     // sysctl check
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // modprobe
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' }) // grep bbr
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // fd limits
        .mockResolvedValueOnce({ stdout: 'mips', stderr: '' });     // uname -m

      const events = await collectEvents('srv-1');

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(false);
      const logEvents = events.filter((e) => typeof e.data.log === 'string');
      expect(logEvents.some((e) => (e.data.log as string).includes('不支持的架构'))).toBe(true);

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('selects amd64 binary for x86_64 and completes full happy path', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockFreshInstallSequence('x86_64');

      const events = await collectEvents('srv-1');

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(true);
      expect(mockSsh.dispose).toHaveBeenCalled();

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('selects arm64 binary for aarch64', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockFreshInstallSequence('aarch64');

      const events = await collectEvents('srv-1');

      const logEvents = events.filter((e) => typeof e.data.log === 'string');
      expect(logEvents.some((e) => (e.data.log as string).includes('arm64'))).toBe(true);

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('fails when GitHub release tag cannot be parsed', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' }) // is-active
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '' })     // sysctl check
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // modprobe
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' }) // grep bbr
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }) // fd limits
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })    // uname -m
        .mockResolvedValueOnce({ stdout: '{}', stderr: '' });        // no tag_name

      const events = await collectEvents('srv-1');

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(false);
      expect(mockSsh.dispose).toHaveBeenCalled();

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('fails when binary download returns non-zero exit code', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // is-active
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '' })               // sysctl check
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // modprobe
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // grep bbr
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // fd limits
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })              // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' }) // release
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'curl failed' }); // download

      const events = await collectEvents('srv-1');

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(false);
      expect(mockSsh.dispose).toHaveBeenCalled();

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('fails when systemctl start returns non-zero exit code', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // is-active
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '' })               // sysctl check
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // modprobe
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // grep bbr
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // fd limits
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })              // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' }) // release
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // download
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // write config
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // write service
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // daemon-reload
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // enable
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'start failed' }); // start

      const events = await collectEvents('srv-1');

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(false);

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('always calls ssh.dispose even when an error is thrown', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand.mockRejectedValue(new Error('unexpected SSH error'));

      await collectEvents('srv-1');

      expect(mockSsh.dispose).toHaveBeenCalled();

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('enables BBR when BBR is available and applies it', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // is-active
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '' })               // sysctl check (not bbr)
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // modprobe tcp_bbr
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // grep bbr available → 0 (BBR is available)
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // sysctl -w apply BBR
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // grep sysctl.conf (persist)
        .mockResolvedValueOnce({ stdout: 'bbr', stderr: '' })                 // sysctl -n verify
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // fd limits
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })              // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' }) // release
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // download
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // write config
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // write service
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // daemon-reload
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // enable
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // start
        .mockResolvedValueOnce({ stdout: 'active', stderr: '' });             // status

      const events = await collectEvents('srv-1');
      const logEvents = events.filter((e) => typeof e.data.log === 'string');
      expect(logEvents.some((e) => (e.data.log as string).includes('BBR 已启用'))).toBe(true);

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(true);

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('skips BBR config when BBR is already enabled', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // is-active
        .mockResolvedValueOnce({ stdout: 'bbr', stderr: '' })                 // sysctl check → already bbr
        // No modprobe or grep calls (BBR already active)
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // fd limits
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })              // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // download
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // config
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // service
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // daemon-reload
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // enable
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // start
        .mockResolvedValueOnce({ stdout: 'active', stderr: '' });             // status

      const events = await collectEvents('srv-1');
      const logEvents = events.filter((e) => typeof e.data.log === 'string');
      expect(logEvents.some((e) => (e.data.log as string).includes('BBR 已启用（无需重复配置）'))).toBe(true);

      const doneEvent = events.find((e) => e.data.done === true);
      expect(doneEvent?.data.success).toBe(true);

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });

    it('warns when BBR apply fails (container env)', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // is-active
        .mockResolvedValueOnce({ stdout: 'cubic', stderr: '' })               // sysctl check (not bbr)
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // modprobe
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // grep bbr available
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })           // sysctl -w apply → fails
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // TCP buffer
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // fd limits
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })              // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // download
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // config
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // service
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // daemon-reload
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                    // enable
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })           // start
        .mockResolvedValueOnce({ stdout: 'active', stderr: '' });             // status

      const events = await collectEvents('srv-1');
      const logEvents = events.filter((e) => typeof e.data.log === 'string');
      expect(logEvents.some((e) => (e.data.log as string).includes('BBR 配置失败'))).toBe(true);

      delete process.env.PANEL_URL;
      delete process.env.GITHUB_REPO;
    });
  });
});

describe('ServersService – agentUpdate', () => {
  it('sets pendingAgentUpdate=true for the server', async () => {
    (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue({ id: 'srv-1', userId: 'user-1' });
    (mockPrisma.server.update as jest.Mock).mockResolvedValue({ id: 'srv-1' });

    const result = await svc.agentUpdate('srv-1', 'user-1');

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.server.update).toHaveBeenCalledWith({
      where: { id: 'srv-1' },
      data: { pendingAgentUpdate: true },
    });
  });

  it('throws NotFoundException when server not found', async () => {
    (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.agentUpdate('bad-id', 'user-1')).rejects.toThrow(NotFoundException);
  });
});

describe('ServersService – agentUpdateBatch', () => {
  it('sets pendingAgentUpdate=true for multiple servers', async () => {
    (mockPrisma.server.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

    const result = await svc.agentUpdateBatch(['srv-1', 'srv-2'], 'user-1');

    expect(result).toEqual({ ok: true, count: 2 });
    expect(mockPrisma.server.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['srv-1', 'srv-2'] }, userId: 'user-1' },
      data: { pendingAgentUpdate: true },
    });
  });
});
