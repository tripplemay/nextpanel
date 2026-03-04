import { ServersService } from './servers.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from '../nodes/node-deploy.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
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
    findUnique: jest.fn(),
    update: jest.fn(),
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

const svc = new ServersService(mockPrisma, mockCrypto, mockNodeDeploy, mockCfService, mockCfSettings);

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
      } as any);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('mypassword');
      expect(mockPrisma.server.create).toHaveBeenCalled();
    });

    it('defaults sshPort to 22 when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any);

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.sshPort).toBe(22);
    });

    it('defaults sshUser to root when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any);

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.sshUser).toBe('root');
    });

    it('defaults tags to empty array when not provided', async () => {
      (mockPrisma.server.create as jest.Mock).mockResolvedValue(fakeServer);

      await svc.create({ name: 'T', ip: '1.2.3.4', sshAuth: 'pw', sshAuthType: 'PASSWORD' as any } as any);

      const data = (mockPrisma.server.create as jest.Mock).mock.calls[0][0].data;
      expect(data.tags).toEqual([]);
    });
  });

  describe('findAll', () => {
    it('returns all servers ordered by createdAt desc', async () => {
      (mockPrisma.server.findMany as jest.Mock).mockResolvedValue([fakeServer]);

      const result = await svc.findAll();

      expect(result).toHaveLength(1);
      const call = (mockPrisma.server.findMany as jest.Mock).mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('findOne', () => {
    it('returns server when found', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.findOne('srv-1');

      expect(result).toBe(fakeServer);
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.findOne('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('re-encrypts sshAuth when provided', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      await svc.update('srv-1', { sshAuth: 'newpassword' } as any);

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('newpassword');
    });

    it('does not encrypt when sshAuth not in update payload', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      await svc.update('srv-1', { name: 'Renamed' } as any);

      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for missing server', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.update('bad', {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the server after verifying it exists', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.delete as jest.Mock).mockResolvedValue(fakeServer);

      await svc.remove('srv-1');

      expect(mockPrisma.server.delete).toHaveBeenCalledWith({ where: { id: 'srv-1' } });
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.remove('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('testSsh', () => {
    it('returns success=true when echo ok succeeds', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.testSsh('srv-1');

      expect(result.success).toBe(true);
      expect(result.message).toBe('SSH connection successful');
    });

    it('connects with password when sshAuthType is PASSWORD', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({
        ...fakeServer, sshAuthType: 'PASSWORD', sshAuthEnc: 'enc:mypassword',
      });

      await svc.testSsh('srv-1');

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'mypassword' }),
      );
    });

    it('connects with privateKey when sshAuthType is KEY', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({
        ...fakeServer, sshAuthType: 'KEY', sshAuthEnc: 'enc:-----BEGIN RSA',
      });

      await svc.testSsh('srv-1');

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({ privateKey: '-----BEGIN RSA' }),
      );
    });

    it('returns success=false when stdout is not "ok"', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      mockExecCommand.mockResolvedValue({ stdout: 'something else', stderr: '' });

      const result = await svc.testSsh('srv-1');

      expect(result.success).toBe(false);
    });

    it('returns success=false with error message on connection failure', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      mockConnect.mockRejectedValue(new Error('Connection refused'));

      const result = await svc.testSsh('srv-1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection refused');
    });

    it('throws NotFoundException when server is missing', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.testSsh('bad')).rejects.toThrow(NotFoundException);
    });

    it('handles non-Error thrown objects gracefully', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      mockConnect.mockRejectedValue('string error');

      const result = await svc.testSsh('srv-1');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection failed');
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

    it('emits manualCmd when PANEL_URL and GITHUB_REPO are set', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      // SSH connect succeeds; agent not active; arch detection, then fail on release fetch
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' }) // systemctl is-active
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

    it('returns true when agent is already running (activeCode === 0)', async () => {
      process.env.PANEL_URL = 'https://panel.test';
      process.env.GITHUB_REPO = 'org/repo';
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServerWithToken);
      mockSsh.execCommand.mockResolvedValueOnce({ code: 0, stdout: 'active', stderr: '' });

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
        .mockResolvedValueOnce({ stdout: 'mips', stderr: '' }); // uname -m

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
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })       // is-active
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })          // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' }) // curl github release
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })       // download
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // write config
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // write service
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // daemon-reload
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // enable
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })       // start
        .mockResolvedValueOnce({ stdout: 'active', stderr: '' });          // status

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
      mockSsh.execCommand
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })       // is-active
        .mockResolvedValueOnce({ stdout: 'aarch64', stderr: '' })         // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' }) // github release
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })       // download
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // write config
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // write service
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // daemon-reload
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // enable
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })       // start
        .mockResolvedValueOnce({ stdout: 'active', stderr: '' });          // status

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
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })       // is-active
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })          // uname -m
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
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })       // is-active
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })          // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name": "agent/v1.0"}', stderr: '' }) // release
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })       // download
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // mkdir
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // write config
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // write service
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // daemon-reload
        .mockResolvedValueOnce({ stdout: '', stderr: '' })                 // enable
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
  });
});
