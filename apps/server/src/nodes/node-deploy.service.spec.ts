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

const svc = new NodeDeployService(mockPrisma, mockCrypto);

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
    .mockResolvedValueOnce({ stderr: '' })   // daemon-reload
    .mockResolvedValueOnce({ stderr: '' })   // enable+restart
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
  // Default exec: daemon-reload → enable+restart → is-active (active)
  mockExecCommand
    .mockResolvedValueOnce({ stderr: '' })
    .mockResolvedValueOnce({ stderr: '' })
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
        .mockResolvedValueOnce({ stderr: '' })    // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })    // enable+restart
        .mockResolvedValueOnce({ stdout: 'failed' }); // is-active

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
      // installXray SSH commands + daemon-reload + enable+restart + is-active
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' })   // install script
        .mockResolvedValueOnce({ code: 0 })                  // test -x xray
        .mockResolvedValueOnce({ stderr: '' })               // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })               // enable+restart
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

    it('silently handles SSH errors during undeploy', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockRejectedValue(new Error('SSH failed'));

      await expect(svc.undeploy('node-1')).resolves.toBeUndefined();
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
});
