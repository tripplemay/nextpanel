import { NodeDeployService } from './node-deploy.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NotFoundException } from '@nestjs/common';

// ── Mock all SSH utilities ────────────────────────────────────────────────────
const mockConnectSsh = jest.fn();
const mockUploadText = jest.fn().mockResolvedValue(undefined);
const mockBinaryExists = jest.fn().mockResolvedValue(true);
const mockWhichBinary = jest.fn().mockResolvedValue('/usr/bin/ss-server');
const mockDetectPackageManager = jest.fn().mockResolvedValue('apt');

jest.mock('./ssh/ssh.util', () => ({
  connectSsh: (...args: unknown[]) => mockConnectSsh(...args),
  uploadText: (...args: unknown[]) => mockUploadText(...args),
  binaryExists: (...args: unknown[]) => mockBinaryExists(...args),
  whichBinary: (...args: unknown[]) => mockWhichBinary(...args),
  detectPackageManager: (...args: unknown[]) => mockDetectPackageManager(...args),
}));

// ── Mock NodeSSH instance ─────────────────────────────────────────────────────
const mockExecCommand = jest.fn();
const mockDispose = jest.fn();
const mockSsh = { execCommand: mockExecCommand, dispose: mockDispose };

// ── Mock config generator ─────────────────────────────────────────────────────
jest.mock('./config/config-generator', () => ({
  generateConfig: jest.fn().mockReturnValue('{"config":true}'),
  getBinaryCommand: jest.fn().mockReturnValue({ bin: '/usr/local/bin/xray', args: 'run -c CONFIG_PATH' }),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockPrisma = {
  node: {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  configSnapshot: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
} as unknown as PrismaService;

const mockCrypto = {
  encrypt: jest.fn((s: string) => `enc:${s}`),
  decrypt: jest.fn((s: string) => s.replace('enc:', '')),
} as unknown as CryptoService;

const mockOperationLog = {
  createLog: jest.fn().mockResolvedValue({}),
  listByNode: jest.fn().mockResolvedValue([]),
  getLog: jest.fn().mockResolvedValue(null),
} as unknown as import('../operation-log/operation-log.service').OperationLogService;

const svc = new NodeDeployService(mockPrisma, mockCrypto, mockOperationLog);

const fakeServer = {
  id: 'srv-1', ip: '1.2.3.4', sshPort: 22,
  sshUser: 'root', sshAuthType: 'PASSWORD', sshAuthEnc: 'enc:secret',
};

const fakeNode = {
  id: 'node-1', name: 'Test Node',
  protocol: 'VMESS', implementation: 'XRAY', transport: 'TCP', tls: 'NONE',
  listenPort: 10086, domain: null,
  credentialsEnc: 'enc:{"uuid":"abc"}',
  server: fakeServer,
};

function setupHappyPath() {
  (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
  (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue({ version: 1 });
  (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
  (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
  mockConnectSsh.mockResolvedValue(mockSsh);
  mockBinaryExists.mockResolvedValue(true);
  mockExecCommand
    .mockResolvedValueOnce({ stderr: '' })    // daemon-reload
    .mockResolvedValueOnce({ stderr: '' })    // enable+restart
    .mockResolvedValueOnce({ stdout: '' })    // openFirewallPort
    .mockResolvedValueOnce({ stdout: 'active' }); // is-active
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore defaults that clearAllMocks wipes in Jest 30
  mockUploadText.mockResolvedValue(undefined);
  mockDispose.mockReturnValue(undefined);
  mockBinaryExists.mockResolvedValue(true);
  mockWhichBinary.mockResolvedValue('/usr/bin/ss-server');
  mockDetectPackageManager.mockResolvedValue('apt');
  (mockPrisma.node.delete as jest.Mock).mockResolvedValue({});
  (mockOperationLog.createLog as jest.Mock).mockResolvedValue({});
  // Default exec: daemon-reload → enable+restart → openFirewallPort → is-active (active)
  mockExecCommand
    .mockResolvedValueOnce({ stderr: '' })
    .mockResolvedValueOnce({ stderr: '' })
    .mockResolvedValueOnce({ stdout: '' })
    .mockResolvedValueOnce({ stdout: 'active' });
});

// Speed up the 2s timer in deploy
jest.useFakeTimers();

describe('NodeDeployService', () => {
  describe('deploy', () => {
    it('throws NotFoundException when node is not found', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.deploy('bad-node')).rejects.toThrow(NotFoundException);
    });

    it('returns success=true when service becomes active', async () => {
      setupHappyPath();

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.log).toContain('Deployment completed successfully');
    });

    it('returns success=false when service is not active', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue({ version: 1 });
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      // Override default exec: is-active returns 'failed'
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })     // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })     // enable+restart
        .mockResolvedValueOnce({ stdout: '' })     // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'failed' }) // is-active
        .mockResolvedValueOnce({ stdout: '' });    // journalctl (triggered when !isActive)

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
    });

    it('calls onLog callback with progress messages', async () => {
      setupHappyPath();
      const logs: string[] = [];

      const promise = svc.deploy('node-1', (line) => logs.push(line));
      jest.runAllTimersAsync();
      await promise;

      expect(logs.some((l) => l.includes('Starting deployment'))).toBe(true);
    });

    it('returns success=false on SSH connect error', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockRejectedValue(new Error('Connection refused'));

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('Connection refused');
    });

    it('handles binary not found and auto-install success', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue({ version: 1 });
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists
        .mockResolvedValueOnce(false)  // first check: binary missing
        .mockResolvedValueOnce(true);  // second check: after install
      // installXray SSH commands + daemon-reload + enable+restart + firewall (1 call) + is-active
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' })   // install script
        .mockResolvedValueOnce({ code: 0 })                  // test -x xray
        .mockResolvedValueOnce({ stderr: '' })               // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })               // enable+restart
        .mockResolvedValueOnce({ stdout: '' })               // openFirewallPort (combined)
        .mockResolvedValueOnce({ stdout: 'active' });        // is-active

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
    });

    it('returns success=false when auto-install returns null', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue({
        ...fakeNode, implementation: 'UNKNOWN_IMPL',
      });
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      // Reset to ensure false is returned regardless of previous test state
      mockBinaryExists.mockReset();
      mockBinaryExists.mockResolvedValue(false);
      mockExecCommand.mockReset();

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('Auto-install failed');
    });

    it('finalize creates config snapshot with incremented version', async () => {
      setupHappyPath();
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue({ version: 5 });

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      await promise;

      const createCall = (mockPrisma.configSnapshot.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.version).toBe(6);
    });

    it('finalize uses version 1 when no prior snapshot exists', async () => {
      setupHappyPath();
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      await promise;

      const createCall = (mockPrisma.configSnapshot.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.version).toBe(1);
    });
  });

  describe('undeploy', () => {
    it('silently returns when node is not found', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.undeploy('bad-node')).resolves.toBeUndefined();
    });

    it('connects SSH and runs cleanup commands', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await svc.undeploy('node-1');

      expect(mockConnectSsh).toHaveBeenCalled();
      expect(mockExecCommand).toHaveBeenCalledWith(
        expect.stringContaining('systemctl stop'),
      );
      expect(mockDispose).toHaveBeenCalled();
    });

    it('re-throws SSH errors during undeploy so caller can abort deletion', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockRejectedValue(new Error('SSH failed'));

      await expect(svc.undeploy('node-1')).rejects.toThrow('SSH failed');
    });
  });

  describe('deployStream', () => {
    it('returns an Observable that emits done event', (done) => {
      setupHappyPath();

      const obs$ = svc.deployStream('node-1');
      const events: unknown[] = [];

      obs$.subscribe({
        next: (event) => events.push(event),
        complete: () => {
          const lastEvent = events[events.length - 1] as { data: { done: boolean } };
          expect(lastEvent.data.done).toBe(true);
          done();
        },
      });

      // advance the 2s timer
      jest.runAllTimersAsync();
    });

    it('emits done:true with success=false on deploy error', (done) => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(null); // → NotFoundException

      const obs$ = svc.deployStream('node-1');
      const events: unknown[] = [];

      obs$.subscribe({
        next: (event) => events.push(event),
        complete: () => {
          const lastEvent = events[events.length - 1] as { data: { success: boolean } };
          expect(lastEvent.data.success).toBe(false);
          done();
        },
      });
    });
  });

  describe('toggleService', () => {
    it('connects SSH and runs start command when enabling', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();
      mockExecCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await svc.toggleService('node-1', true);

      expect(mockConnectSsh).toHaveBeenCalled();
      expect(mockExecCommand).toHaveBeenCalledWith(expect.stringContaining('start'));
      expect(mockDispose).toHaveBeenCalled();
    });

    it('connects SSH and runs stop command when disabling', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();
      mockExecCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await svc.toggleService('node-1', false);

      expect(mockExecCommand).toHaveBeenCalledWith(expect.stringContaining('stop'));
    });

    it('throws NotFoundException when node is not found', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.toggleService('bad', true)).rejects.toThrow(NotFoundException);
    });

    it('re-throws SSH errors', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockRejectedValue(new Error('SSH error'));
      await expect(svc.toggleService('node-1', true)).rejects.toThrow('SSH error');
    });
  });

  describe('deploy — TLS cert generation', () => {
    it('runs openssl command for TLS nodes', async () => {
      const tlsNode = { ...fakeNode, tls: 'TLS' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(tlsNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue({ version: 1 });
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })    // TLS cert (openssl)
        .mockResolvedValueOnce({ stderr: '' })    // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })    // enable+restart
        .mockResolvedValueOnce({ stdout: '' })    // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockExecCommand.mock.calls[0][0]).toContain('openssl');
    });
  });

  describe('deploy — binary re-verify fails after install', () => {
    it('returns success=false when binary still missing after auto-install', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists
        .mockResolvedValueOnce(false)  // initial check: missing
        .mockResolvedValueOnce(false); // re-verify after install: still missing
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // install script
        .mockResolvedValueOnce({ code: 0 });               // test -x xray succeeds → installXray returns true

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('still not found');
    });
  });

  describe('deploy — SS_LIBEV resolves different binary path', () => {
    it('overrides bin when autoInstall resolves to different path', async () => {
      const ssNode = { ...fakeNode, implementation: 'SS_LIBEV' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(ssNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue({ version: 1 });
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists
        .mockResolvedValueOnce(false)  // initial check: missing
        .mockResolvedValueOnce(true);  // re-verify: found at resolved path
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // apt install ss-libev
        .mockResolvedValueOnce({ stderr: '' })             // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })             // enable+restart
        .mockResolvedValueOnce({ stdout: '' })             // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' });      // is-active

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logs.some((l) => l.includes('resolved binary path'))).toBe(true);
    });
  });

  describe('undeployStream', () => {
    it('emits done=true success=true on successful undeploy', (done) => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })             // closeFirewallPort
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // systemctl disable + rm + daemon-reload

      const obs$ = svc.undeployStream('node-1');
      const events: unknown[] = [];

      obs$.subscribe({
        next: (event) => events.push(event),
        complete: () => {
          const lastEvent = events[events.length - 1] as { data: { done: boolean; success: boolean } };
          expect(lastEvent.data.done).toBe(true);
          expect(lastEvent.data.success).toBe(true);
          expect(mockPrisma.node.delete).toHaveBeenCalledWith({ where: { id: 'node-1' } });
          done();
        },
      });
    });

    it('emits done=true success=false when SSH connect fails', (done) => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockRejectedValue(new Error('SSH timeout'));

      const obs$ = svc.undeployStream('node-1');
      const events: unknown[] = [];

      obs$.subscribe({
        next: (event) => events.push(event),
        complete: () => {
          const lastEvent = events[events.length - 1] as { data: { done: boolean; success: boolean } };
          expect(lastEvent.data.done).toBe(true);
          expect(lastEvent.data.success).toBe(false);
          done();
        },
      });
    });
  });
});
