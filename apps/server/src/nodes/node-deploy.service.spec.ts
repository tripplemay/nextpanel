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

const mockCertService = {
  ensureWildcardCert: jest.fn().mockResolvedValue({ certPath: '/tmp/cert.crt', keyPath: '/tmp/cert.key' }),
  pushCertToNode: jest.fn().mockResolvedValue(undefined),
} as unknown as import('../common/cert/cert.service').CertService;

const mockCfSettings = {
  getDecryptedToken: jest.fn().mockResolvedValue(null),
} as unknown as import('../cloudflare/cloudflare-settings.service').CloudflareSettingsService;

const mockCfService = {
  deleteRecord: jest.fn().mockResolvedValue(undefined),
} as unknown as import('../cloudflare/cloudflare.service').CloudflareService;

const svc = new NodeDeployService(mockPrisma, mockCrypto, mockOperationLog, mockCertService, mockCfSettings, mockCfService);

const fakeServer = {
  id: 'srv-1', ip: '1.2.3.4', sshPort: 22,
  sshUser: 'root', sshAuthType: 'PASSWORD', sshAuthEnc: 'enc:secret',
};

const fakeNode = {
  id: 'node-1', name: 'Test Node',
  protocol: 'VMESS', implementation: 'XRAY', transport: 'TCP', tls: 'NONE',
  listenPort: 10086, domain: null, source: null, userId: 'user-1',
  credentialsEnc: 'enc:{"uuid":"abc"}',
  server: fakeServer,
};

/**
 * Set up the standard happy-path mock sequence for deploy().
 *
 * After binary check, the SSH command sequence is:
 *   1. daemon-reload
 *   2. systemctl stop  (port cleanup)
 *   3. pkill           (orphan cleanup)
 *   4. fuser {statsPort}/tcp  → empty stdout (freePortIfOrphaned — no pid found)
 *   5. fuser {listenPort}/tcp → empty stdout (freePortIfOrphaned — no pid found)
 *   6. systemctl enable && start
 *   7. systemctl is-active (post-start check)
 *   8. openFirewallPort (1 call for VMESS/TCP)
 *   9. systemctl is-active  → 'active'
 */
function setupHappyPath() {
  (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
  (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue({ version: 1 });
  (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
  (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
  mockConnectSsh.mockResolvedValue(mockSsh);
  mockBinaryExists.mockResolvedValue(true);
  mockExecCommand
    .mockResolvedValueOnce({ stderr: '' })        // 1. daemon-reload
    .mockResolvedValueOnce({ stderr: '' })        // 2. systemctl stop
    .mockResolvedValueOnce({ stdout: '' })        // 3. pkill
    .mockResolvedValueOnce({ stdout: '' })        // 4. fuser statsPort (no pid)
    .mockResolvedValueOnce({ stdout: '' })        // 5. fuser listenPort (no pid)
    .mockResolvedValueOnce({ stderr: '' })        // 6. systemctl enable && start
    .mockResolvedValueOnce({ stdout: 'active' })  // 7. is-active (post-start)
    .mockResolvedValueOnce({ stdout: '' })        // 8. openFirewallPort
    .mockResolvedValueOnce({ stdout: 'active' }); // 9. is-active (final)
}

beforeEach(() => {
  jest.clearAllMocks();
  // Restore defaults that clearAllMocks wipes
  mockUploadText.mockResolvedValue(undefined);
  mockDispose.mockReturnValue(undefined);
  mockBinaryExists.mockResolvedValue(true);
  mockWhichBinary.mockResolvedValue('/usr/bin/ss-server');
  mockDetectPackageManager.mockResolvedValue('apt');
  (mockPrisma.node.delete as jest.Mock).mockResolvedValue({});
  (mockOperationLog.createLog as jest.Mock).mockResolvedValue({});
  // Default exec sequence: happy path for VMESS/XRAY node
  mockExecCommand
    .mockResolvedValueOnce({ stderr: '' })        // daemon-reload
    .mockResolvedValueOnce({ stderr: '' })        // systemctl stop
    .mockResolvedValueOnce({ stdout: '' })        // pkill
    .mockResolvedValueOnce({ stdout: '' })        // fuser statsPort
    .mockResolvedValueOnce({ stdout: '' })        // fuser listenPort
    .mockResolvedValueOnce({ stderr: '' })        // systemctl enable && start
    .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
    .mockResolvedValueOnce({ stdout: '' })        // openFirewallPort
    .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)
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
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })        // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })        // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })        // pkill
        .mockResolvedValueOnce({ stdout: '' })        // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })        // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })        // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })        // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'failed' })  // is-active (final) → not active
        .mockResolvedValueOnce({ stdout: 'journal output' }); // journalctl

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
    });

    it('logs journal output when service is not active', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })         // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })         // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })         // pkill
        .mockResolvedValueOnce({ stdout: '' })         // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })         // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })         // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })   // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })         // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'inactive' }) // is-active (final)
        .mockResolvedValueOnce({ stdout: 'Error: xray crashed' }); // journalctl

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      await promise;

      expect(logs.some((l) => l.includes('xray crashed'))).toBe(true);
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
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })                      // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name":"v26.2.6"}', stderr: '' })      // github API
        .mockResolvedValueOnce({ code: 0, stderr: '' })                               // ensureUnzip: command -v unzip → present
        .mockResolvedValueOnce({ stderr: '' })                                         // download + extract + install
        .mockResolvedValueOnce({ code: 0 })                                            // test -x xray
        .mockResolvedValueOnce({ stderr: '' })                                         // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })                                         // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })                                         // pkill
        .mockResolvedValueOnce({ stdout: '' })                                         // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })                                         // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })                                         // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })                                  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })                                         // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' });                                  // is-active (final)

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

    it('logs daemon-reload warning when stderr is non-empty', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: 'some warning' }) // daemon-reload with warning
        .mockResolvedValueOnce({ stderr: '' })             // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })             // pkill
        .mockResolvedValueOnce({ stdout: '' })             // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })             // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })             // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })       // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })             // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' });      // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      await promise;

      expect(logs.some((l) => l.includes('daemon-reload warning'))).toBe(true);
    });

    it('logs start warning when stderr is non-empty on enable+start', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })              // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })              // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })              // pkill
        .mockResolvedValueOnce({ stdout: '' })              // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })              // fuser listenPort
        .mockResolvedValueOnce({ stderr: 'start warning' }) // systemctl enable+start
        .mockResolvedValueOnce({ stdout: 'active' })        // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })              // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' });       // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      await promise;

      expect(logs.some((l) => l.includes('Start warning'))).toBe(true);
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

    it('disposes SSH on error', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      // Reset to clear the beforeEach Once values, then set a permanent reject
      mockExecCommand.mockReset();
      mockExecCommand.mockRejectedValue(new Error('exec failed'));

      await expect(svc.undeploy('node-1')).rejects.toThrow('exec failed');
      expect(mockDispose).toHaveBeenCalled();
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

    it('disposes SSH on execCommand error', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();
      mockExecCommand.mockRejectedValue(new Error('exec error'));

      await expect(svc.toggleService('node-1', true)).rejects.toThrow('exec error');
      expect(mockDispose).toHaveBeenCalled();
    });
  });

  describe('deploy — TLS cert generation', () => {
    it('runs openssl command for TLS nodes (self-signed fallback)', async () => {
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
        .mockResolvedValueOnce({ stderr: '' })    // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })    // pkill
        .mockResolvedValueOnce({ stdout: '' })    // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })    // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })    // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })    // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockExecCommand.mock.calls[0][0]).toContain('openssl');
    });

    it('uses Let\'s Encrypt cert when TLS, TCP, AUTO source, domain set, and CF token available', async () => {
      const tlsNode = {
        ...fakeNode, tls: 'TLS', transport: 'TCP', source: 'AUTO', domain: 'sub.example.com',
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(tlsNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', zoneId: 'zone-1', domain: 'example.com',
      });
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })    // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })    // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })    // pkill
        .mockResolvedValueOnce({ stdout: '' })    // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })    // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })    // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })    // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockCertService.ensureWildcardCert).toHaveBeenCalled();
      expect(mockCertService.pushCertToNode).toHaveBeenCalled();
    });

    it('falls back to self-signed cert when TLS, AUTO source, but no CF token', async () => {
      const tlsNode = {
        ...fakeNode, tls: 'TLS', transport: 'TCP', source: 'AUTO', domain: 'sub.example.com',
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(tlsNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue(null);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })    // openssl (self-signed fallback)
        .mockResolvedValueOnce({ stderr: '' })    // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })    // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })    // pkill
        .mockResolvedValueOnce({ stdout: '' })    // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })    // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })    // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })    // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      await promise;

      expect(logs.some((l) => l.includes('No CF settings found'))).toBe(true);
      expect(mockExecCommand.mock.calls[0][0]).toContain('openssl');
    });

    it('logs TLS cert warning when openssl stderr is non-empty', async () => {
      const tlsNode = { ...fakeNode, tls: 'TLS' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(tlsNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: 'openssl warning' }) // openssl with warning
        .mockResolvedValueOnce({ stderr: '' })         // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })         // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })         // pkill
        .mockResolvedValueOnce({ stdout: '' })         // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })         // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })         // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })   // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })         // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      await promise;

      expect(logs.some((l) => l.includes('TLS cert warning'))).toBe(true);
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
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })                 // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name":"v26.2.6"}', stderr: '' }) // github API
        .mockResolvedValueOnce({ code: 0, stderr: '' })                           // ensureUnzip: command -v unzip → present
        .mockResolvedValueOnce({ stderr: '' })                                    // download + extract + install
        .mockResolvedValueOnce({ code: 0 });                                      // test -x xray succeeds → installXray returns true

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('still not found');
    });
  });

  describe('deploy — SS_LIBEV resolves different binary path', () => {
    it('overrides bin when autoInstall resolves to different path', async () => {
      // SS_LIBEV implementation on a VMESS protocol node:
      //   - isXray=false → no statsPort → only 1 freePortIfOrphaned call
      //   - protocol=VMESS → getFirewallProtocols returns ['tcp'] → 1 firewall call
      const ssNode = { ...fakeNode, implementation: 'SS_LIBEV' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(ssNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue({ version: 1 });
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists
        .mockResolvedValueOnce(false)  // initial check: binary missing
        .mockResolvedValueOnce(true);  // re-verify: found at resolved path
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // apt install ss-libev
        .mockResolvedValueOnce({ stderr: '' })             // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })             // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })             // pkill
        .mockResolvedValueOnce({ stdout: '' })             // fuser listenPort (no statsPort for SS_LIBEV)
        .mockResolvedValueOnce({ stderr: '' })             // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })       // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })             // openFirewallPort tcp (VMESS = TCP only)
        .mockResolvedValueOnce({ stdout: 'active' });      // is-active (final)

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

  describe('deploy — freePortIfOrphaned kills orphaned proxy process', () => {
    it('kills orphaned xray process occupying the listen port', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })        // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })        // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })        // pkill
        .mockResolvedValueOnce({ stdout: '' })        // fuser statsPort (no pid)
        .mockResolvedValueOnce({ stdout: '1234' })    // fuser listenPort (pid found)
        .mockResolvedValueOnce({ stdout: 'xray' })    // cat /proc/1234/comm
        .mockResolvedValueOnce({ stdout: '' })        // kill -9
        .mockResolvedValueOnce({ stderr: '' })        // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })        // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logs.some((l) => l.includes('orphaned xray'))).toBe(true);
    });

    it('warns but skips non-proxy process occupying the listen port', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })        // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })        // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })        // pkill
        .mockResolvedValueOnce({ stdout: '' })        // fuser statsPort (no pid)
        .mockResolvedValueOnce({ stdout: '9999' })    // fuser listenPort (pid found)
        .mockResolvedValueOnce({ stdout: 'nginx' })   // cat /proc/9999/comm (not a proxy)
        .mockResolvedValueOnce({ stderr: '' })        // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })        // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logs.some((l) => l.includes('WARNING') && l.includes('nginx'))).toBe(true);
    });
  });

  describe('deploy — refreshCert', () => {
    it('throws NotFoundException when node is not found', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.refreshCert('bad-node')).rejects.toThrow(NotFoundException);
    });

    it('returns early when node has no domain', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue({ ...fakeNode, domain: null });
      await expect(svc.refreshCert('node-1')).resolves.toBeUndefined();
      expect(mockConnectSsh).not.toHaveBeenCalled();
    });

    it('pushes cert and restarts service when node has domain', async () => {
      const nodeWithDomain = { ...fakeNode, domain: 'sub.example.com' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(nodeWithDomain);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();
      mockExecCommand.mockResolvedValue({ stdout: '', stderr: '' });

      await svc.refreshCert('node-1');

      expect(mockCertService.pushCertToNode).toHaveBeenCalled();
      expect(mockExecCommand).toHaveBeenCalledWith(expect.stringContaining('restart'));
      expect(mockDispose).toHaveBeenCalled();
    });

    it('disposes SSH and re-throws on error', async () => {
      const nodeWithDomain = { ...fakeNode, domain: 'sub.example.com' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(nodeWithDomain);
      mockConnectSsh.mockResolvedValue(mockSsh);
      (mockCertService.pushCertToNode as jest.Mock).mockRejectedValue(new Error('cert push failed'));

      await expect(svc.refreshCert('node-1')).rejects.toThrow('cert push failed');
      expect(mockDispose).toHaveBeenCalled();
    });
  });

  describe('getFirewallProtocols (via deploy)', () => {
    it('opens TCP+UDP ports for SHADOWSOCKS protocol', async () => {
      const ssNode = { ...fakeNode, protocol: 'SHADOWSOCKS', implementation: 'XRAY' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(ssNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })  // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })  // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })  // pkill
        .mockResolvedValueOnce({ stdout: '' })  // fuser statsPort
        .mockResolvedValueOnce({ stdout: '' })  // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })  // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })  // openFirewallPort tcp
        .mockResolvedValueOnce({ stdout: '' })  // openFirewallPort udp
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      // Two firewall calls: one tcp + one udp
      const firewallCalls = mockExecCommand.mock.calls.filter(
        (c: string[]) => (c[0] as string).includes('ufw') || (c[0] as string).includes('iptables'),
      );
      expect(firewallCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('opens only UDP port for HYSTERIA2 protocol', async () => {
      const hyNode = { ...fakeNode, protocol: 'HYSTERIA2', implementation: 'SING_BOX' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(hyNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })  // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })  // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })  // pkill
        .mockResolvedValueOnce({ stdout: '' })  // fuser listenPort (no statsPort for SING_BOX)
        .mockResolvedValueOnce({ stderr: '' })  // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })  // openFirewallPort udp only
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
    });
  });

  describe('deploy — privileged port firewall skip', () => {
    it('skips firewall for privileged port (<1024)', async () => {
      const privNode = { ...fakeNode, listenPort: 443 };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(privNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })  // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })  // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })  // pkill
        .mockResolvedValueOnce({ stdout: '' })  // fuser statsPort (443+20000=20443)
        .mockResolvedValueOnce({ stdout: '' })  // fuser listenPort (443)
        .mockResolvedValueOnce({ stderr: '' })  // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })  // is-active (post-start)
        // no openFirewallPort call (privileged port 443 is skipped)
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logs.some((l) => l.includes('Skipping firewall'))).toBe(true);
    });
  });

  describe('deploy — V2RAY auto-install', () => {
    it('auto-installs V2Ray and deploys successfully', async () => {
      const v2rayNode = { ...fakeNode, implementation: 'V2RAY' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(v2rayNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists
        .mockResolvedValueOnce(false)  // initial check: missing
        .mockResolvedValueOnce(true);  // re-verify: installed
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ code: 0, stderr: '' })  // ensureUnzip: command -v unzip → present
        .mockResolvedValueOnce({ stdout: 'v2ray output', stderr: '' }) // curl install script
        .mockResolvedValueOnce({ code: 0 })                // test -x /usr/local/bin/v2ray
        .mockResolvedValueOnce({ stderr: '' })             // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })             // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })             // pkill
        .mockResolvedValueOnce({ stdout: '' })             // fuser statsPort/tcp (V2RAY is xray-like, has statsPort)
        .mockResolvedValueOnce({ stdout: '' })             // fuser listenPort/tcp
        .mockResolvedValueOnce({ stderr: '' })             // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })       // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })             // openFirewallPort tcp
        .mockResolvedValueOnce({ stdout: 'active' });      // is-active (final)

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
    });

    it('returns success=false when V2Ray install fails (binary test fails)', async () => {
      const v2rayNode = { ...fakeNode, implementation: 'V2RAY' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(v2rayNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(false); // always missing
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ code: 0, stderr: '' })  // ensureUnzip: command -v unzip → present
        .mockResolvedValueOnce({ stdout: '', stderr: '' })  // install script
        .mockResolvedValueOnce({ code: 1 });                // test -x v2ray fails

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('Auto-install failed');
    });
  });

  describe('deploy — SING_BOX auto-install', () => {
    it('auto-installs sing-box and deploys successfully', async () => {
      const singboxNode = { ...fakeNode, implementation: 'SING_BOX' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(singboxNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists
        .mockResolvedValueOnce(false)  // initial check: missing
        .mockResolvedValueOnce(true);  // re-verify: installed
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })   // uname -m
        .mockResolvedValueOnce({ stdout: '1.8.0', stderr: '' })    // curl github release version
        .mockResolvedValueOnce({ stderr: '' })                      // download + install
        .mockResolvedValueOnce({ code: 0 })                        // test -x sing-box
        .mockResolvedValueOnce({ stderr: '' })                     // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })                     // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })                     // pkill
        .mockResolvedValueOnce({ stdout: '' })                     // fuser listenPort (SING_BOX: isXray=false)
        .mockResolvedValueOnce({ stderr: '' })                     // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })               // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })                     // openFirewallPort tcp
        .mockResolvedValueOnce({ stdout: 'active' });              // is-active (final)

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
    });

    it('returns success=false when sing-box version fetch fails', async () => {
      const singboxNode = { ...fakeNode, implementation: 'SING_BOX' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(singboxNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(false);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' }) // uname -m
        .mockResolvedValueOnce({ stdout: '', stderr: '' });       // empty version (no output)

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('Auto-install failed');
    });

    it('logs download error when sing-box download has stderr', async () => {
      const singboxNode = { ...fakeNode, implementation: 'SING_BOX' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(singboxNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(false);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })      // uname -m
        .mockResolvedValueOnce({ stdout: '1.8.0', stderr: '' })       // version
        .mockResolvedValueOnce({ stderr: 'download error', stdout: '' }) // download fails
        .mockResolvedValueOnce({ code: 1 });                           // test -x fails

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      await promise;

      expect(logs.some((l) => l.includes('download error'))).toBe(true);
    });
  });

  describe('deploy — SS_LIBEV with dnf and yum package managers', () => {
    it('installs ss-libev with dnf package manager', async () => {
      const ssNode = { ...fakeNode, implementation: 'SS_LIBEV' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(ssNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockDetectPackageManager.mockResolvedValue('dnf');
      mockWhichBinary.mockResolvedValue('/usr/bin/ss-server');
      mockBinaryExists
        .mockResolvedValueOnce(false)  // initial check: missing
        .mockResolvedValueOnce(true);  // re-verify
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: 'installed output', stderr: '' }) // dnf install
        .mockResolvedValueOnce({ stderr: '' })   // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })   // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })   // pkill
        .mockResolvedValueOnce({ stdout: '' })   // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })   // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })   // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })   // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logs.some((l) => l.includes('dnf'))).toBe(true);
    });

    it('installs ss-libev with yum package manager', async () => {
      const ssNode = { ...fakeNode, implementation: 'SS_LIBEV' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(ssNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockDetectPackageManager.mockResolvedValue('yum');
      mockWhichBinary.mockResolvedValue('/usr/sbin/ss-server');
      mockBinaryExists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // yum install
        .mockResolvedValueOnce({ stderr: '' })   // daemon-reload
        .mockResolvedValueOnce({ stderr: '' })   // systemctl stop
        .mockResolvedValueOnce({ stdout: '' })   // pkill
        .mockResolvedValueOnce({ stdout: '' })   // fuser listenPort
        .mockResolvedValueOnce({ stderr: '' })   // systemctl enable && start
        .mockResolvedValueOnce({ stdout: 'active' })   // is-active (post-start)
        .mockResolvedValueOnce({ stdout: '' })   // openFirewallPort
        .mockResolvedValueOnce({ stdout: 'active' }); // is-active (final)

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(logs.some((l) => l.includes('yum'))).toBe(true);
    });

    it('returns success=false when no supported package manager found', async () => {
      const ssNode = { ...fakeNode, implementation: 'SS_LIBEV' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(ssNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockDetectPackageManager.mockResolvedValue('pacman'); // unsupported
      mockBinaryExists.mockResolvedValue(false);
      mockExecCommand.mockReset();

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('Auto-install failed');
    });

    it('returns success=false when whichBinary returns null after install', async () => {
      const ssNode = { ...fakeNode, implementation: 'SS_LIBEV' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(ssNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockDetectPackageManager.mockResolvedValue('apt');
      mockWhichBinary.mockResolvedValue(null); // ss-server not found after install
      mockBinaryExists.mockResolvedValue(false);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // apt install

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('Auto-install failed');
    });
  });

  describe('deploy — Xray install failed (binary test fails)', () => {
    it('returns success=false when Xray binary test fails after download', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(false); // always missing
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })          // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name":"v1.0"}', stderr: '' }) // github API
        .mockResolvedValueOnce({ code: 0, stderr: '' })                    // ensureUnzip: command -v unzip → present
        .mockResolvedValueOnce({ stderr: 'download failed', stdout: '' }) // download with error
        .mockResolvedValueOnce({ code: 1 }); // test -x xray fails

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('Auto-install failed');
      expect(logs.some((l) => l.includes('Xray install failed'))).toBe(true);
    });
  });

  describe('deploy — Xray install aborts when unzip cannot be installed', () => {
    it('fails fast with diagnostic when ensureUnzip cannot install unzip', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(false); // always missing
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })                  // uname -m
        .mockResolvedValueOnce({ stdout: '{"tag_name":"v1.0"}', stderr: '' })     // github API
        .mockResolvedValueOnce({ code: 1, stderr: '' })                            // ensureUnzip probe: missing
        .mockResolvedValueOnce({ code: 100, stderr: 'E: Could not get lock /var/lib/dpkg/lock-frontend' }) // install attempt fails (dpkg locked)
        .mockResolvedValueOnce({ code: 1, stderr: '' });                           // verify: still missing

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      // Original misleading "unzip: command not found" must NOT appear — we
      // should bail before invoking unzip, with a diagnostic that points at
      // the real cause (dpkg lock).
      expect(logs.some((l) => l.includes('unzip install error') && l.includes('dpkg/lock'))).toBe(true);
      expect(logs.some((l) => l.includes('unzip is still unavailable'))).toBe(true);
      expect(logs.some((l) => l.includes('Xray install failed: unzip unavailable'))).toBe(true);
      // The download/extract command must NOT have run (only 5 mocks consumed).
      expect(mockExecCommand).toHaveBeenCalledTimes(5);
    });
  });

  describe('undeploy — closeFirewallPort for privileged port', () => {
    it('skips close firewall for privileged port (<1024) during undeploy', async () => {
      const privNode = { ...fakeNode, listenPort: 443 };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(privNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // systemctl stop/disable/rm

      const logs: string[] = [];
      await svc.undeploy('node-1');

      // closeFirewallPort was skipped for port 443 (no ufw/iptables call)
      const firewallCalls = mockExecCommand.mock.calls.filter(
        (c: string[]) => (c[0] as string).includes('ufw') || (c[0] as string).includes('iptables'),
      );
      expect(firewallCalls.length).toBe(0);
    });
  });
});
