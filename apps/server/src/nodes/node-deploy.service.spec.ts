import * as crypto from 'crypto';
import { NodeDeployService } from './node-deploy.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NotFoundException } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';
import { generateConfig, generateChainExitConfig } from './config/config-generator';

jest.mock('../common/database/advisory-lock', () => ({
  withPostgresAdvisoryLocks: (_keys: string[], work: () => Promise<unknown>) => work(),
}));

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
  generateChainExitConfig: jest.fn().mockReturnValue('{"chain":true}'),
  getBinaryCommand: jest.fn((node: { implementation?: string | null }) =>
    node.implementation === 'SING_BOX'
      ? { bin: '/usr/local/bin/sing-box', args: 'run -c CONFIG_PATH' }
      : { bin: '/usr/local/bin/xray', args: 'run -c CONFIG_PATH' },
  ),
}));

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockPrisma = {
  $transaction: jest.fn(async (work: (tx: { $queryRawUnsafe: jest.Mock }) => unknown) =>
    work({ $queryRawUnsafe: jest.fn().mockResolvedValue([]) }),
  ),
  node: {
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  server: {
    findUnique: jest.fn(),
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

const mockCertCommit = jest.fn().mockResolvedValue(undefined);
const mockCertRollback = jest.fn().mockResolvedValue(true);
const changedCertUpdate = () => ({
  changed: true,
  commit: mockCertCommit,
  rollback: mockCertRollback,
});
const unchangedCertUpdate = () => ({
  changed: false,
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(true),
});

const mockCertService = {
  ensureWildcardCert: jest.fn().mockResolvedValue({ certPath: '/tmp/cert.crt', keyPath: '/tmp/cert.key' }),
  pushCertToNode: jest.fn().mockResolvedValue(changedCertUpdate()),
} as unknown as import('../common/cert/cert.service').CertService;

const mockCfSettings = {
  getDecryptedToken: jest.fn().mockResolvedValue(null),
} as unknown as import('../cloudflare/cloudflare-settings.service').CloudflareSettingsService;

const mockCfService = {
  deleteRecord: jest.fn().mockResolvedValue(undefined),
} as unknown as import('../cloudflare/cloudflare.service').CloudflareService;

const mockXrayTest = {
  testNode: jest.fn().mockResolvedValue({
    reachable: true,
    latency: 100,
    message: 'TCP/UDP 连接成功',
    testedAt: '2026-08-02T00:00:00.000Z',
  }),
} as unknown as import('./xray-test/xray-test.service').XrayTestService;

const svc = new NodeDeployService(
  mockPrisma,
  mockCrypto,
  mockOperationLog,
  mockCertService,
  mockCfSettings,
  mockCfService,
  mockXrayTest,
);

interface InternalDeployService {
  ensureCoreVersion(
    ssh: typeof mockSsh,
    bin: string,
    impl: string,
    minimumVersion: string,
    log: (msg: string) => void,
  ): Promise<string>;
  stageAndValidateConfig(
    ssh: typeof mockSsh,
    bin: string,
    impl: string,
    content: string,
    configPath: string,
    log: (msg: string) => void,
  ): Promise<string>;
  activateStagedConfig(
    ssh: typeof mockSsh,
    stagedPath: string,
    configPath: string,
    log: (msg: string) => void,
  ): Promise<void>;
  autoInstall(ssh: typeof mockSsh, impl: string, log: (msg: string) => void): Promise<string | null>;
  deployChainExit(...args: unknown[]): Promise<unknown>;
  commitChainExitDeployment(deployment: unknown, log: (msg: string) => void): Promise<void>;
  rollbackChainExitDeployment(deployment: unknown, log: (msg: string) => void): Promise<boolean>;
  restoreDeploymentRollback(
    ssh: typeof mockSsh,
    rollback: Record<string, unknown>,
    log: (msg: string) => void,
  ): Promise<boolean>;
  generateSelfSignedCert(
    ssh: typeof mockSsh,
    nodeId: string,
    cn: string,
    log: (msg: string) => void,
  ): Promise<void>;
}

const internalSvc = svc as unknown as InternalDeployService;

const fakeServer = {
  id: 'srv-1', ip: '1.2.3.4', sshPort: 22,
  sshUser: 'root', sshAuthType: 'PASSWORD', sshAuthEnc: 'enc:secret',
};

const fakeNode = {
  id: 'node-1', name: 'Test Node',
  serverId: 'srv-1', exitServerId: null,
  protocol: 'VMESS', implementation: 'XRAY', transport: 'TCP', tls: 'NONE',
  listenPort: 10086, domain: null, source: null, userId: 'user-1',
  egressIpPolicy: 'AUTO',
  credentialsEnc: 'enc:{"uuid":"abc"}',
  server: fakeServer,
};

function singBoxRelease(version = '1.13.0', arch = 'amd64') {
  const name = `sing-box-${version}-linux-${arch}.tar.gz`;
  return JSON.stringify({
    tag_name: `v${version}`,
    assets: [{ name, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` }],
  });
}

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
  jest.restoreAllMocks();
  jest.clearAllMocks();
  // Restore defaults that clearAllMocks wipes
  mockUploadText.mockResolvedValue(undefined);
  mockDispose.mockReturnValue(undefined);
  mockBinaryExists.mockResolvedValue(true);
  mockWhichBinary.mockResolvedValue('/usr/bin/ss-server');
  mockDetectPackageManager.mockResolvedValue('apt');
  (mockCertService.ensureWildcardCert as jest.Mock).mockResolvedValue({
    certPath: '/tmp/cert.crt',
    keyPath: '/tmp/cert.key',
  });
  mockCertCommit.mockResolvedValue(undefined);
  mockCertRollback.mockResolvedValue(true);
  (mockCertService.pushCertToNode as jest.Mock).mockResolvedValue(changedCertUpdate());
  (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue(null);
  (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);
  (mockPrisma.node.delete as jest.Mock).mockResolvedValue({});
  (mockOperationLog.createLog as jest.Mock).mockResolvedValue({});
  (mockXrayTest.testNode as jest.Mock).mockResolvedValue({
    reachable: true,
    latency: 100,
    message: 'TCP/UDP 连接成功',
    testedAt: '2026-08-02T00:00:00.000Z',
  });
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

    it('rejects deployment while the owning server is deleting', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue({
        ...fakeNode,
        server: { ...fakeServer, status: 'DELETING' },
      });

      await expect(svc.deploy('node-1')).rejects.toThrow('服务器正在删除');
      expect(mockConnectSsh).not.toHaveBeenCalled();
    });

    it('rejects a chain deployment while its exit server is deleting', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue({
        ...fakeNode,
        exitServerId: 'srv-exit',
        exitPort: 15000,
        chainCredEnc: 'enc:{"uuid":"chain-user"}',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({
        ...fakeServer,
        id: 'srv-exit',
        status: 'DELETING',
      });

      await expect(svc.deploy('node-1')).rejects.toThrow('出口服务器正在删除');
      expect(mockConnectSsh).not.toHaveBeenCalled();
    });

    it('returns success=true when service becomes active', async () => {
      setupHappyPath();

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.log).toContain('Deployment completed successfully');
    });

    it('removes control characters from the systemd description', async () => {
      setupHappyPath();
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue({
        ...fakeNode,
        name: 'Safe name\n[Service]\nExecStart=/tmp/nextpanel-pwned',
      });

      const promise = svc.deploy('node-1');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      const unitUpload = mockUploadText.mock.calls.find(
        (call) => String(call[2]).endsWith('.service'),
      );
      expect(unitUpload).toBeDefined();
      const unit = String(unitUpload?.[1]);
      expect(unit).toContain(
        'Description=NextPanel Node: Safe name [Service] ExecStart=/tmp/nextpanel-pwned',
      );
      expect(unit).not.toContain('\nExecStart=/tmp/nextpanel-pwned\n');
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
      const installCommand = mockExecCommand.mock.calls
        .map((call) => call[0] as string)
        .find((command) => command.includes('Xray-linux-64.zip.dgst'));
      expect(installCommand).toContain('sha256sum -c -');
      expect(installCommand).toContain('.xray.nextpanel-');
      expect(installCommand).toContain('mv -f --');
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
      expect(createCall.data.content).toBe('enc:{"config":true}');
      expect(createCall.data.checksum).toBe(
        crypto.createHash('sha256').update('enc:{"config":true}').digest('hex'),
      );
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

    it('rejects a non-zero systemctl result', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset().mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'start failed',
      });

      await expect(svc.toggleService('node-1', true)).rejects.toThrow(
        'Failed to start nextpanel-node-1: start failed',
      );
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

    it('logs successful openssl output when stderr is non-empty', async () => {
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

      expect(logs.some((l) => l.includes('TLS cert output'))).toBe(true);
    });

    it('shell-quotes certificate subject values and fails on openssl errors', async () => {
      mockExecCommand.mockReset().mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'invalid subject',
      });
      const maliciousCn = "bad'$(touch /tmp/nextpanel-pwned)";

      await expect(
        internalSvc.generateSelfSignedCert(mockSsh, 'node-1', maliciousCn, jest.fn()),
      ).rejects.toThrow('Unable to generate self-signed TLS certificate');

      const command = mockExecCommand.mock.calls[0][0] as string;
      expect(command).toContain(
        `-subj '/CN=bad'"'"'$(touch /tmp/nextpanel-pwned)'`,
      );
      expect(command).not.toContain('-subj "/CN=');
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
        .mockResolvedValueOnce({ stdout: '' })        // cgroup has no managed unit
        .mockResolvedValueOnce({ code: 0, stdout: '' }) // kill -9
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

    it('fails closed for a non-proxy process occupying the listen port', async () => {
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

      expect(result.success).toBe(false);
      expect(result.log).toContain('refusing to terminate it');
      expect(mockExecCommand.mock.calls.some(
        (call) => String(call[0]).includes('kill -9 9999'),
      )).toBe(false);
    });

    it('does not kill a proxy process owned by another NextPanel service', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stderr: '' })
        .mockResolvedValueOnce({ stderr: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '4321' })
        .mockResolvedValueOnce({ stdout: 'sing-box' })
        .mockResolvedValueOnce({ stdout: 'nextpanel-other.service' });

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('owned by managed service nextpanel-other.service');
      expect(mockExecCommand.mock.calls.some(
        (call) => String(call[0]).includes('kill -9 4321'),
      )).toBe(false);
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
      const nodeWithDomain = { ...fakeNode, domain: 'sub.example.com', enabled: true };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(nodeWithDomain);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();
      mockExecCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

      await svc.refreshCert('node-1');

      expect(mockCertService.pushCertToNode).toHaveBeenCalled();
      expect(mockExecCommand).toHaveBeenCalledWith(expect.stringContaining('restart'));
      expect(mockCertCommit).toHaveBeenCalledTimes(1);
      expect(mockCertRollback).not.toHaveBeenCalled();
      expect(mockDispose).toHaveBeenCalled();
    });

    it('does not restart when the remote certificate is already current', async () => {
      const nodeWithDomain = { ...fakeNode, domain: 'sub.example.com', enabled: true };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(nodeWithDomain);
      mockConnectSsh.mockResolvedValue(mockSsh);
      (mockCertService.pushCertToNode as jest.Mock).mockResolvedValue(unchangedCertUpdate());
      mockExecCommand.mockReset();

      await svc.refreshCert('node-1');

      expect(mockExecCommand).not.toHaveBeenCalled();
      expect(mockDispose).toHaveBeenCalled();
    });

    it('syncs but does not start a disabled node', async () => {
      const nodeWithDomain = { ...fakeNode, domain: 'sub.example.com', enabled: false };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(nodeWithDomain);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();

      await svc.refreshCert('node-1');

      expect(mockCertService.pushCertToNode).toHaveBeenCalled();
      expect(mockExecCommand).not.toHaveBeenCalled();
      expect(mockCertCommit).toHaveBeenCalledTimes(1);
      expect(mockDispose).toHaveBeenCalled();
    });

    it('throws when restart fails after a certificate update', async () => {
      const nodeWithDomain = { ...fakeNode, domain: 'sub.example.com', enabled: true };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(nodeWithDomain);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset()
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'restart failed' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });

      await expect(svc.refreshCert('node-1')).rejects.toThrow(
        'Failed to restart nextpanel-node-1',
      );
      expect(mockCertRollback).toHaveBeenCalledTimes(1);
      expect(mockCertCommit).not.toHaveBeenCalled();
      expect(mockDispose).toHaveBeenCalled();
    });

    it('throws when the restarted service is not healthy', async () => {
      const nodeWithDomain = { ...fakeNode, domain: 'sub.example.com', enabled: true };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(nodeWithDomain);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset()
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ code: 3, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });

      await expect(svc.refreshCert('node-1')).rejects.toThrow(
        'nextpanel-node-1 is not active',
      );
      expect(mockCertRollback).toHaveBeenCalledTimes(1);
      expect(mockDispose).toHaveBeenCalled();
    });

    it('reports an unverified state when certificate rollback fails', async () => {
      const nodeWithDomain = { ...fakeNode, domain: 'sub.example.com', enabled: true };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(nodeWithDomain);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockCertRollback.mockResolvedValue(false);
      mockExecCommand.mockReset().mockResolvedValue({
        code: 1, stdout: '', stderr: 'restart failed',
      });

      await expect(svc.refreshCert('node-1')).rejects.toThrow(
        'previous TLS certificate could not be restored',
      );
      expect(mockCertRollback).toHaveBeenCalledTimes(1);
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

  describe('deploy — privileged port firewall', () => {
    it('opens port 443 so fixed-port TLS presets remain reachable', async () => {
      const privNode = { ...fakeNode, listenPort: 443 };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(privNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset();
      mockExecCommand.mockImplementation(async (command: string) => {
        if (command.startsWith('test -f ')) {
          return { code: 1, stdout: '', stderr: '' };
        }
        if (command.startsWith('systemctl is-active --quiet ')) {
          return { code: 3, stdout: '', stderr: '' };
        }
        if (command.startsWith('systemctl is-enabled --quiet ')) {
          return { code: 1, stdout: '', stderr: '' };
        }
        if (command === 'systemctl is-active nextpanel-node-1') {
          return { code: 0, stdout: 'active', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });

      const logs: string[] = [];
      const promise = svc.deploy('node-1', (l) => logs.push(l));
      jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockExecCommand.mock.calls.some(
        (call) => String(call[0]).includes('ufw allow 443/tcp'),
      )).toBe(true);
      expect(logs.some((l) => l.includes('Firewall: port 443/tcp opened'))).toBe(true);
    });

    it('fails deployment when an active host firewall cannot be configured', async () => {
      setupHappyPath();
      mockExecCommand.mockReset()
        .mockResolvedValueOnce({ stderr: '' })
        .mockResolvedValueOnce({ stderr: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stderr: '' })
        .mockResolvedValueOnce({ stdout: 'active' })
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'permission denied' });

      const promise = svc.deploy('node-1');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('Failed to open firewall port');
    });

    it('removes a newly-added firewall rule when persistence fails', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === 'systemctl is-active nextpanel-node-1') {
          return { code: 0, stdout: 'active', stderr: '' };
        }
        if (command.includes('ufw allow 10086/tcp')) {
          return { code: 0, stdout: '__NEXTPANEL_FIREWALL_ADDED__', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });
      jest.spyOn(svc as any, 'finalize').mockRejectedValue(new Error('database unavailable'));

      const promise = svc.deploy('node-1');
      jest.runAllTimersAsync();
      await expect(promise).rejects.toThrow('database unavailable');

      expect(mockExecCommand.mock.calls.some(
        (call) => String(call[0]).includes('ufw --force delete allow 10086/tcp'),
      )).toBe(true);
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
        .mockResolvedValueOnce({ stdout: singBoxRelease(), stderr: '' }) // GitHub release
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
      const installCommand = mockExecCommand.mock.calls
        .map((call) => call[0] as string)
        .find((command) => command.includes('sing-box-1.13.0-linux-amd64.tar.gz'));
      expect(installCommand).toContain('sha256sum -c -');
      expect(installCommand).toContain('a'.repeat(64));
      expect(installCommand).toContain('.sing-box.nextpanel-');
      expect(installCommand).toContain('mv -f --');
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

    it('rejects a sing-box release without an official asset digest', async () => {
      const singboxNode = { ...fakeNode, implementation: 'SING_BOX' };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(singboxNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(false);
      mockExecCommand.mockReset()
        .mockResolvedValueOnce({ stdout: 'x86_64', stderr: '' })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            tag_name: 'v1.13.0',
            assets: [{
              name: 'sing-box-1.13.0-linux-amd64.tar.gz',
              state: 'uploaded',
              digest: null,
            }],
          }),
          stderr: '',
        });

      const result = await svc.deploy('node-1');

      expect(result.success).toBe(false);
      expect(result.log).toContain('Official SHA-256 digest is unavailable');
      expect(mockExecCommand.mock.calls.some(
        (call) => (call[0] as string).includes('releases/download'),
      )).toBe(false);
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
        .mockResolvedValueOnce({ stdout: singBoxRelease(), stderr: '' }) // GitHub release
        .mockResolvedValueOnce({ code: 1, stderr: 'download error', stdout: '' }) // download fails
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
        .mockResolvedValueOnce({ stdout: '{"tag_name":"v1.0.0"}', stderr: '' }) // github API
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
        .mockResolvedValueOnce({ stdout: '{"tag_name":"v1.0.0"}', stderr: '' })   // github API
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
    it('removes the firewall rule for port 443 during undeploy', async () => {
      const privNode = { ...fakeNode, listenPort: 443 };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(privNode);
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockExecCommand.mockReset();
      mockExecCommand
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // systemctl stop/disable/rm
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' }); // close firewall

      const logs: string[] = [];
      await svc.undeploy('node-1');

      const firewallCalls = mockExecCommand.mock.calls.filter(
        (c: string[]) => (c[0] as string).includes('ufw') || (c[0] as string).includes('iptables'),
      );
      expect(firewallCalls).toHaveLength(1);
      expect(firewallCalls[0][0]).toContain('ufw --force delete allow 443/tcp');
      expect(firewallCalls[0][0]).toContain('nextpanel-managed');
    });
  });

  describe('deploy — modern protocol core versions', () => {
    it.each([
      ['XRAY', '/usr/local/bin/xray', '25.3.6', 'Xray 25.3.6 (Xray, Penetrates Everything.)'],
      ['SING_BOX', '/usr/local/bin/sing-box', '1.12.0', 'sing-box version 1.12.0\nEnvironment: linux/amd64'],
    ])('accepts stable %s product output at the minimum version', async (
      impl,
      bin,
      minimum,
      output,
    ) => {
      mockExecCommand.mockReset().mockResolvedValue({ code: 0, stdout: output, stderr: '' });

      await expect(
        internalSvc.ensureCoreVersion(mockSsh, bin, impl, minimum, jest.fn()),
      ).resolves.toBe(bin);
      expect(mockExecCommand).toHaveBeenCalledWith(`${bin} version 2>&1`);
    });

    it('backs up the old core, preflights every matching unit, then removes the backup', async () => {
      const bin = '/usr/local/bin/xray';
      jest.spyOn(internalSvc, 'autoInstall').mockResolvedValue(bin);
      mockBinaryExists.mockResolvedValue(true);
      let versionReads = 0;
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === `${bin} version 2>&1`) {
          versionReads += 1;
          return {
            code: 0,
            stdout: versionReads === 1 ? 'Xray 24.1.1' : 'Xray 26.2.6',
            stderr: '',
          };
        }
        if (command.startsWith('cp -p --')) return { code: 0, stdout: '', stderr: '' };
        if (command.startsWith('find /etc/systemd/system')) {
          return {
            code: 0,
            stdout:
              '/etc/systemd/system/nextpanel-old.service\n' +
              '/etc/systemd/system/nextpanel-sing.service\n',
            stderr: '',
          };
        }
        if (command.includes('nextpanel-old.service')) {
          return {
            code: 0,
            stdout: `ExecStart=${bin} run -config /etc/nextpanel/nodes/old.json`,
            stderr: '',
          };
        }
        if (command.includes('nextpanel-sing.service')) {
          return {
            code: 0,
            stdout: 'ExecStart=/usr/local/bin/sing-box run -c /etc/nextpanel/nodes/sing.json',
            stderr: '',
          };
        }
        return { code: 0, stdout: 'Configuration OK', stderr: '' };
      });

      await expect(
        internalSvc.ensureCoreVersion(mockSsh, bin, 'XRAY', '25.3.6', jest.fn()),
      ).resolves.toBe(bin);

      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      const validationIndex = commands.findIndex((command) =>
        command.includes("run -test -config '/etc/nextpanel/nodes/old.json'"),
      );
      const backupCommand = commands.find((command) => command.startsWith('cp -p --'));
      const cleanupIndex = commands.findIndex((command) =>
        command.startsWith(`rm -f -- '${bin}.nextpanel-backup-`),
      );
      expect(backupCommand).toMatch(
        /^cp -p -- '\/usr\/local\/bin\/xray' '\/usr\/local\/bin\/xray\.nextpanel-backup-[0-9a-f-]{36}' && test -x '\/usr\/local\/bin\/xray\.nextpanel-backup-[0-9a-f-]{36}'$/,
      );
      expect(validationIndex).toBeGreaterThan(-1);
      expect(cleanupIndex).toBeGreaterThan(validationIndex);
      expect(commands.some((command) => command.includes('/sing.json') && command.includes('check')))
        .toBe(false);
    });

    it('atomically restores the old core when an existing config is incompatible', async () => {
      const bin = '/usr/local/bin/xray';
      jest.spyOn(internalSvc, 'autoInstall').mockResolvedValue(bin);
      mockBinaryExists.mockResolvedValue(true);
      let versionReads = 0;
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === `${bin} version 2>&1`) {
          versionReads += 1;
          return {
            code: 0,
            stdout: versionReads === 1 ? 'Xray 24.1.1' : 'Xray 26.2.6',
            stderr: '',
          };
        }
        if (command.startsWith('cp -p --')) return { code: 0, stdout: '', stderr: '' };
        if (command.startsWith('find /etc/systemd/system')) {
          return {
            code: 0,
            stdout: '/etc/systemd/system/nextpanel-quic.service\n',
            stderr: '',
          };
        }
        if (command.startsWith('sed -n')) {
          return {
            code: 0,
            stdout: `ExecStart=${bin} run -config /etc/nextpanel/nodes/quic.json`,
            stderr: '',
          };
        }
        if (command.includes("run -test -config '/etc/nextpanel/nodes/quic.json'")) {
          return { code: 1, stdout: 'unknown transport protocol: quic', stderr: '' };
        }
        if (command.startsWith(`mv -f -- '${bin}.nextpanel-backup-`)) {
          return { code: 0, stdout: '', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });

      let failure: Error | null = null;
      try {
        await internalSvc.ensureCoreVersion(mockSsh, bin, 'XRAY', '25.3.6', jest.fn());
      } catch (err) {
        failure = err as Error;
      }

      expect(failure?.message).toContain('Migrate these existing configs before retrying');
      expect(failure?.message).toContain('nextpanel-quic.service');
      expect(failure?.message).toContain('/etc/nextpanel/nodes/quic.json');
      expect(failure?.message).toContain('unknown transport protocol: quic');
      expect(failure?.message).toContain('Previous XRAY binary restored');
      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands.some((command) =>
        command.startsWith(`mv -f -- '${bin}.nextpanel-backup-`) && command.endsWith(`' '${bin}'`),
      )).toBe(true);
      expect(commands.some((command) =>
        command.startsWith(`rm -f -- '${bin}.nextpanel-backup-`),
      )).toBe(false);
    });

    it('restores the old core when the upgrade itself fails', async () => {
      const bin = '/usr/local/bin/sing-box';
      jest.spyOn(internalSvc, 'autoInstall').mockResolvedValue(null);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === `${bin} version 2>&1`) {
          return { code: 0, stdout: 'sing-box version 1.10.0', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });

      await expect(
        internalSvc.ensureCoreVersion(mockSsh, bin, 'SING_BOX', '1.12.0', jest.fn()),
      ).rejects.toThrow(
        'Unable to install SING_BOX >= 1.12.0. Previous SING_BOX binary restored.',
      );
      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands.some((command) =>
        command.startsWith(`mv -f -- '${bin}.nextpanel-backup-`) && command.endsWith(`' '${bin}'`),
      )).toBe(true);
      expect(commands.some((command) => command.startsWith('find /etc/systemd/system')))
        .toBe(false);
    });

    it('keeps the existing no-backup behavior when no prior binary exists', async () => {
      const bin = '/usr/local/bin/xray';
      jest.spyOn(internalSvc, 'autoInstall').mockResolvedValue(null);
      mockBinaryExists.mockResolvedValue(false);
      mockExecCommand.mockReset().mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'not found',
      });

      await expect(
        internalSvc.ensureCoreVersion(mockSsh, bin, 'XRAY', '25.3.6', jest.fn()),
      ).rejects.toThrow('Unable to install XRAY >= 25.3.6');
      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands.some((command) => command.startsWith('cp -p --'))).toBe(false);
      expect(commands.some((command) => command.startsWith('mv -f --'))).toBe(false);
    });

    it.each([
      ['a failed command', { code: 1, stdout: 'sing-box version 1.12.0', stderr: 'broken' }],
      ['a prerelease', { code: 0, stdout: 'sing-box version 1.12.0-beta.1', stderr: '' }],
      ['another product output', { code: 0, stdout: 'Xray 26.2.6', stderr: '' }],
    ])('rejects %s as a stable sing-box version', async (_label, response) => {
      mockExecCommand.mockReset().mockResolvedValue(response);
      mockBinaryExists.mockResolvedValue(false);
      const installSpy = jest.spyOn(internalSvc, 'autoInstall').mockResolvedValue(null);

      await expect(
        internalSvc.ensureCoreVersion(
          mockSsh,
          '/usr/local/bin/sing-box',
          'SING_BOX',
          '1.12.0',
          jest.fn(),
        ),
      ).rejects.toThrow('Unable to install SING_BOX >= 1.12.0');
      expect(installSpy).toHaveBeenCalled();
    });
  });

  describe('deploy — staged config integrity', () => {
    const configPath = '/etc/nextpanel/nodes/node-1.json';
    const content = '{"config":"new"}';
    const checksum = crypto.createHash('sha256').update(content).digest('hex');

    it('uses a unique stage, verifies its checksum, validates, then activates it', async () => {
      mockExecCommand.mockReset()
        .mockResolvedValueOnce({ code: 0, stdout: `${checksum}  staged`, stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: 'Configuration OK', stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });

      const stagedPath = await internalSvc.stageAndValidateConfig(
        mockSsh,
        '/usr/local/bin/xray',
        'XRAY',
        content,
        configPath,
        jest.fn(),
      );
      expect(stagedPath).toMatch(
        /^\/etc\/nextpanel\/nodes\/node-1\.json\.next-[0-9a-f-]{36}\.json$/,
      );
      expect(mockUploadText).toHaveBeenCalledWith(mockSsh, content, stagedPath);
      expect(mockExecCommand).toHaveBeenNthCalledWith(1, `sha256sum -- ${stagedPath}`);
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        2,
        `/usr/local/bin/xray run -test -config ${stagedPath} 2>&1`,
      );

      await internalSvc.activateStagedConfig(mockSsh, stagedPath, configPath, jest.fn());
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        3,
        `mv -f ${stagedPath} ${configPath}`,
      );
    });

    it('cleans a checksum mismatch without validating or replacing the active config', async () => {
      mockExecCommand.mockReset()
        .mockResolvedValueOnce({ code: 0, stdout: `${'0'.repeat(64)}  staged`, stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });

      await expect(
        internalSvc.stageAndValidateConfig(
          mockSsh,
          '/usr/local/bin/sing-box',
          'SING_BOX',
          content,
          configPath,
          jest.fn(),
        ),
      ).rejects.toThrow('Staged config checksum verification failed');

      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands.some((command) => command.includes('sing-box check'))).toBe(false);
      expect(commands.some((command) => command.startsWith('mv -f'))).toBe(false);
      expect(commands.some((command) => command.startsWith('rm -f') && command.includes('.next-'))).toBe(true);
    });

    it('preserves the active config when engine validation fails', async () => {
      mockExecCommand.mockReset()
        .mockResolvedValueOnce({ code: 0, stdout: `${checksum}  staged`, stderr: '' })
        .mockResolvedValueOnce({ code: 1, stdout: 'invalid inbound', stderr: '' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });

      await expect(
        internalSvc.stageAndValidateConfig(
          mockSsh,
          '/usr/local/bin/sing-box',
          'SING_BOX',
          content,
          configPath,
          jest.fn(),
        ),
      ).rejects.toThrow('Config validation failed: invalid inbound');

      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands).toContainEqual(expect.stringContaining('sing-box check -c'));
      expect(commands.some((command) => command.startsWith('mv -f'))).toBe(false);
      expect(commands.some((command) => command.startsWith('rm -f') && command.includes('.next-'))).toBe(true);
    });

    it('removes the staged file when atomic activation fails', async () => {
      const stagedPath = `${configPath}.next-tested.json`;
      mockExecCommand.mockReset()
        .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'read-only filesystem' })
        .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });

      await expect(
        internalSvc.activateStagedConfig(
          mockSsh,
          stagedPath,
          configPath,
          jest.fn(),
        ),
      ).rejects.toThrow('Unable to activate validated config: read-only filesystem');

      expect(mockExecCommand).toHaveBeenNthCalledWith(
        2,
        `rm -f ${stagedPath}`,
      );
    });
  });

  describe('deploy — XHTTP, TUIC, and AnyTLS', () => {
    const cases = [
      {
        label: 'XHTTP',
        node: { protocol: 'VLESS', implementation: 'XRAY', transport: 'XHTTP', tls: 'REALITY' },
        version: 'Xray 25.3.6 (Xray, Penetrates Everything.)',
        versionBin: '/usr/local/bin/xray',
        socket: 'tcp',
      },
      {
        label: 'TUIC',
        node: { protocol: 'TUIC', implementation: 'SING_BOX', transport: null, tls: 'TLS' },
        version: 'sing-box version 1.12.0',
        versionBin: '/usr/local/bin/sing-box',
        socket: 'udp',
      },
      {
        label: 'AnyTLS',
        node: { protocol: 'ANYTLS', implementation: 'SING_BOX', transport: null, tls: 'TLS' },
        version: 'sing-box version 1.12.0',
        versionBin: '/usr/local/bin/sing-box',
        socket: 'tcp',
      },
    ];

    it.each(cases)('enforces the core version and deploys $label through staging', async ({
      node: shape,
      version,
      versionBin,
      socket,
    }) => {
      const modernNode = {
        ...fakeNode,
        ...shape,
        source: 'MANUAL',
        domain: shape.tls === 'TLS' ? 'np-node-1.example.com' : null,
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(modernNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token',
        zoneId: 'zone-1',
        domain: 'example.com',
      });
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === `${versionBin} version 2>&1`) {
          return { code: 0, stdout: version, stderr: '' };
        }
        if (command.includes('systemctl is-active')) {
          return { code: 0, stdout: 'active', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });
      const stagedPath = `/etc/nextpanel/nodes/${modernNode.id}.json.next-tested`;
      const stageSpy = jest
        .spyOn(internalSvc, 'stageAndValidateConfig')
        .mockResolvedValue(stagedPath);
      const activateSpy = jest
        .spyOn(internalSvc, 'activateStagedConfig')
        .mockResolvedValue(undefined);

      const promise = svc.deploy(modernNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockExecCommand).toHaveBeenCalledWith(`${versionBin} version 2>&1`);
      expect(stageSpy).toHaveBeenCalledWith(
        mockSsh,
        versionBin,
        shape.implementation,
        '{"config":true}',
        `/etc/nextpanel/nodes/${modernNode.id}.json`,
        expect.any(Function),
      );
      expect(activateSpy).toHaveBeenCalledWith(
        mockSsh,
        stagedPath,
        `/etc/nextpanel/nodes/${modernNode.id}.json`,
        expect.any(Function),
      );

      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands).toContain(`fuser ${modernNode.listenPort}/${socket} 2>/dev/null || true`);
      expect(commands.some(
        (command) => command.includes(`ufw allow ${modernNode.listenPort}/${socket}`),
      )).toBe(true);
      if (shape.tls === 'TLS') {
        expect(mockCertService.ensureWildcardCert).toHaveBeenCalledWith(
          'cf-token',
          'example.com',
          expect.any(Function),
        );
        expect(mockCertService.pushCertToNode).toHaveBeenCalled();
        expect(commands.some((command) => command.includes('openssl req'))).toBe(false);
      }
    });

    it('restores the previous modern deployment when the replacement does not start', async () => {
      const modernNode = {
        ...fakeNode,
        protocol: 'VLESS',
        implementation: 'XRAY',
        transport: 'XHTTP',
        tls: 'REALITY',
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(modernNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === '/usr/local/bin/xray version 2>&1') {
          return {
            code: 0,
            stdout: 'Xray 26.2.6 (Xray, Penetrates Everything.)',
            stderr: '',
          };
        }
        if (command.startsWith('test -f ') || command.startsWith('cp -p -- ')) {
          return { code: 0, stdout: '', stderr: '' };
        }
        if (command.includes('systemctl is-active --quiet') ||
            command.includes('systemctl is-enabled --quiet')) {
          return { code: 0, stdout: '', stderr: '' };
        }
        if (command === 'systemctl is-active nextpanel-node-1') {
          return { code: 3, stdout: 'failed', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(
        '/etc/nextpanel/nodes/node-1.json.next-tested.json',
      );
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);

      const promise = svc.deploy(modernNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      const restoreCommand = commands.find((command) => command.startsWith('failed=0;'));
      expect(restoreCommand).toContain("cp -p -- '/etc/nextpanel/nodes/node-1.json.rollback-");
      expect(restoreCommand).toContain(
        "cp -p -- '/etc/systemd/system/nextpanel-node-1.service.rollback-",
      );
      expect(restoreCommand).toContain("systemctl enable 'nextpanel-node-1'");
      expect(restoreCommand).toContain("systemctl start 'nextpanel-node-1'");
      expect(commands.filter(
        (command) => command === "systemctl is-active --quiet 'nextpanel-node-1'",
      )).toHaveLength(2);
      expect(result.log).toContain('Previous deployment restored for nextpanel-node-1');
      expect(result.rollbackFailed).toBeUndefined();
    });

    it('marks the deploy result when the previous remote deployment cannot be restored', async () => {
      const modernNode = {
        ...fakeNode,
        protocol: 'VLESS',
        implementation: 'XRAY',
        transport: 'XHTTP',
        tls: 'REALITY',
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(modernNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === '/usr/local/bin/xray version 2>&1') {
          return { code: 0, stdout: 'Xray 26.2.6 (Xray, Penetrates Everything.)', stderr: '' };
        }
        if (command === 'systemctl is-active nextpanel-node-1') {
          return { code: 3, stdout: 'failed', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(
        '/etc/nextpanel/nodes/node-1.json.next-tested.json',
      );
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);
      jest.spyOn(internalSvc, 'restoreDeploymentRollback').mockResolvedValue(false);

      const promise = svc.deploy(modernNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.rollbackFailed).toBe(true);
    });

    it('retries rollback and retains backups when restored service health never recovers', async () => {
      const logs: string[] = [];
      const rollback = {
        configPath: '/etc/nextpanel/nodes/node-1.json',
        unitPath: '/etc/systemd/system/nextpanel-node-1.service',
        configBackupPath: '/etc/nextpanel/nodes/node-1.json.rollback-test',
        unitBackupPath: '/etc/systemd/system/nextpanel-node-1.service.rollback-test',
        serviceName: 'nextpanel-node-1',
        hadConfig: true,
        hadUnit: true,
        wasActive: true,
        wasEnabled: true,
      };
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === "systemctl is-active --quiet 'nextpanel-node-1'") {
          return { code: 3, stdout: '', stderr: 'inactive' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });

      await expect(
        internalSvc.restoreDeploymentRollback(mockSsh, rollback, (message) => logs.push(message)),
      ).resolves.toBe(false);

      const commands = mockExecCommand.mock.calls.map((call) => call[0] as string);
      expect(commands.filter((command) => command.startsWith('failed=0;'))).toHaveLength(2);
      expect(commands.some((command) => command.startsWith('rm -f --'))).toBe(false);
      expect(logs.join('\n')).toContain('rollback attempt 1 failed');
      expect(logs.join('\n')).toContain(rollback.configBackupPath);
      expect(logs.join('\n')).toContain(rollback.unitBackupPath);
    });

    it.each([
      ['TUIC', null],
      ['ANYTLS', '   '],
    ])('requires a managed domain for %s without self-signed fallback', async (protocol, domain) => {
      const modernNode = {
        ...fakeNode,
        protocol,
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        source: 'MANUAL',
        domain,
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(modernNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset().mockResolvedValue({
        code: 0,
        stdout: 'sing-box version 1.12.0',
        stderr: '',
      });
      const stageSpy = jest.spyOn(internalSvc, 'stageAndValidateConfig');

      const result = await svc.deploy(modernNode.id);

      expect(result.success).toBe(false);
      expect(result.log).toContain('requires a managed domain and trusted TLS certificate');
      expect(stageSpy).not.toHaveBeenCalled();
      expect(mockCertService.ensureWildcardCert).not.toHaveBeenCalled();
      expect(mockExecCommand.mock.calls.some(
        (call) => (call[0] as string).includes('openssl req'),
      )).toBe(false);
    });

    it.each(['TUIC', 'ANYTLS'])('fails closed when %s has no Cloudflare token', async (protocol) => {
      const modernNode = {
        ...fakeNode,
        protocol,
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        source: 'MANUAL',
        domain: 'np-node-1.example.com',
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(modernNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue(null);
      mockExecCommand.mockReset().mockResolvedValue({
        code: 0,
        stdout: 'sing-box version 1.12.0',
        stderr: '',
      });

      const result = await svc.deploy(modernNode.id);

      expect(result.success).toBe(false);
      expect(result.log).toContain('requires valid Cloudflare settings');
      expect(mockCertService.ensureWildcardCert).not.toHaveBeenCalled();
      expect(mockExecCommand.mock.calls.some(
        (call) => (call[0] as string).includes('openssl req'),
      )).toBe(false);
    });

    it('does not fall back when trusted certificate issuance fails', async () => {
      const modernNode = {
        ...fakeNode,
        protocol: 'ANYTLS',
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        source: 'MANUAL',
        domain: 'np-node-1.example.com',
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(modernNode);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token',
        zoneId: 'zone-1',
        domain: 'example.com',
      });
      (mockCertService.ensureWildcardCert as jest.Mock).mockRejectedValue(
        new Error('ACME issuance failed'),
      );
      mockExecCommand.mockReset().mockResolvedValue({
        code: 0,
        stdout: 'sing-box version 1.12.0',
        stderr: '',
      });

      const result = await svc.deploy(modernNode.id);

      expect(result.success).toBe(false);
      expect(result.log).toContain('ACME issuance failed');
      expect(mockCertService.pushCertToNode).not.toHaveBeenCalled();
      expect(mockExecCommand.mock.calls.some(
        (call) => (call[0] as string).includes('openssl req'),
      )).toBe(false);
    });
  });

  describe('deploy — modern chain ordering', () => {
    function setupChainNode(overrides: Record<string, unknown> = {}) {
      const chainNode = {
        ...fakeNode,
        protocol: 'VLESS',
        implementation: 'XRAY',
        transport: 'XHTTP',
        tls: 'REALITY',
        exitServerId: 'exit-1',
        exitPort: 15001,
        chainCredEnc: 'enc:chain-uuid',
        ...overrides,
      };
      const exitServer = {
        id: 'exit-1',
        ip: '5.6.7.8',
        sshPort: 22,
        sshUser: 'root',
        sshAuthType: 'PASSWORD',
        sshAuthEnc: 'enc:exit-secret',
      };
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(chainNode);
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(exitServer);
      (mockPrisma.configSnapshot.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.configSnapshot.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      mockConnectSsh.mockResolvedValue(mockSsh);
      mockBinaryExists.mockResolvedValue(true);
      mockExecCommand.mockReset().mockImplementation(async (command: string) => {
        if (command === '/usr/local/bin/xray version 2>&1') {
          return { code: 0, stdout: 'Xray 26.2.6 (Xray, Penetrates Everything.)', stderr: '' };
        }
        if (command.includes('systemctl is-active')) {
          return { code: 0, stdout: 'active', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });
      return chainNode;
    }

    it('validates a Hysteria2 entry before exit deployment despite having no version requirement', async () => {
      const chainNode = setupChainNode({
        protocol: 'HYSTERIA2',
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        domain: null,
      });
      const events: string[] = [];
      const stagedPath = `/etc/nextpanel/nodes/${chainNode.id}.json.next-tested`;
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockImplementation(async () => {
        events.push('entry-validated');
        return stagedPath;
      });
      jest.spyOn(internalSvc, 'deployChainExit').mockImplementation(async () => {
        events.push('exit-active');
      });
      jest.spyOn(internalSvc, 'activateStagedConfig').mockImplementation(async () => {
        events.push('entry-activated');
      });

      const promise = svc.deploy(chainNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(events).toEqual(['entry-validated', 'exit-active', 'entry-activated']);
    });

    it('deploys only the entry and requires TCP/UDP verification for a SOCKS5 exit', async () => {
      const socksNode = setupChainNode({
        protocol: 'VMESS',
        transport: 'TCP',
        tls: 'NONE',
        exitType: 'SOCKS5',
        exitServerId: null,
        exitPort: null,
        chainCredEnc: null,
        socksExitEnc: 'enc:{"version":5,"host":"proxy.example.com","port":1080,"username":"user","password":"pass"}',
      });
      const stagedPath = `/etc/nextpanel/nodes/${socksNode.id}.json.next-tested`;
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(stagedPath);
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);
      const deployExitSpy = jest.spyOn(internalSvc, 'deployChainExit');

      const promise = svc.deploy(socksNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(generateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          socksExit: {
            version: 5,
            host: 'proxy.example.com',
            port: 1080,
            username: 'user',
            password: 'pass',
          },
        }),
        expect.any(Object),
      );
      expect(deployExitSpy).not.toHaveBeenCalled();
      expect(mockXrayTest.testNode).toHaveBeenCalledWith(socksNode.id);
    });

    it('rolls the entry back when SOCKS5 UDP verification fails', async () => {
      const socksNode = setupChainNode({
        protocol: 'VMESS',
        transport: 'TCP',
        tls: 'NONE',
        exitType: 'SOCKS5',
        exitServerId: null,
        exitPort: null,
        chainCredEnc: null,
        socksExitEnc: 'enc:{"version":5,"host":"proxy.example.com","port":1080}',
      });
      const stagedPath = `/etc/nextpanel/nodes/${socksNode.id}.json.next-tested`;
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(stagedPath);
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);
      const rollbackSpy = jest.spyOn(internalSvc, 'restoreDeploymentRollback').mockResolvedValue(true);
      (mockXrayTest.testNode as jest.Mock).mockResolvedValue({
        reachable: false,
        latency: -1,
        message: 'SOCKS5 UDP ASSOCIATE 无响应',
        testedAt: '2026-08-02T00:00:00.000Z',
      });

      const promise = svc.deploy(socksNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('SOCKS5 UDP ASSOCIATE 无响应');
      expect(rollbackSpy).toHaveBeenCalled();
    });

    it('keeps the active entry config and cleans its stage when exit deployment fails', async () => {
      const chainNode = setupChainNode();
      const stagedPath = `/etc/nextpanel/nodes/${chainNode.id}.json.next-tested`;
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(stagedPath);
      jest.spyOn(internalSvc, 'deployChainExit').mockRejectedValue(new Error('exit failed'));
      const activateSpy = jest.spyOn(internalSvc, 'activateStagedConfig');

      const result = await svc.deploy(chainNode.id);

      expect(result.success).toBe(false);
      expect(result.log).toContain('exit failed');
      expect(activateSpy).not.toHaveBeenCalled();
      expect(mockExecCommand).toHaveBeenCalledWith(`rm -f ${stagedPath}`);
    });

    it('passes the encrypted REALITY envelope to both chain endpoints', async () => {
      const chainCredentials = {
        uuid: '18af1f8a-0941-4fe1-b4e7-a8c088f5f3c1',
        realityPrivateKey: 'private-key',
        realityPublicKey: 'public-key',
        shortId: '0123456789abcdef',
      };
      const chainNode = setupChainNode({
        chainCredEnc: `enc:${JSON.stringify(chainCredentials)}`,
      });
      const stagedPath = `/etc/nextpanel/nodes/${chainNode.id}.json.next-tested.json`;
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(stagedPath);
      jest.spyOn(internalSvc, 'deployChainExit').mockResolvedValue(undefined);
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);

      const promise = svc.deploy(chainNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(generateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          egressIpPolicy: 'AUTO',
          chainUuid: chainCredentials.uuid,
          chainRealityPrivateKey: chainCredentials.realityPrivateKey,
          chainRealityPublicKey: chainCredentials.realityPublicKey,
          chainShortId: chainCredentials.shortId,
        }),
        expect.any(Object),
      );
    });

    it('configures the chain exit with the REALITY private key and short ID', async () => {
      const chainCredentials = {
        uuid: '18af1f8a-0941-4fe1-b4e7-a8c088f5f3c1',
        realityPrivateKey: 'private-key',
        realityPublicKey: 'public-key',
        shortId: '0123456789abcdef',
      };
      const connectSpy = jest.spyOn(NodeSSH.prototype, 'connect').mockResolvedValue({} as NodeSSH);
      const execSpy = jest.spyOn(NodeSSH.prototype, 'execCommand').mockImplementation(
        async (command: string) => ({
          code: 0,
          stdout: command.includes('systemctl is-active') ? 'active' : '',
          stderr: '',
        } as any),
      );
      const disposeSpy = jest.spyOn(NodeSSH.prototype, 'dispose').mockImplementation(() => undefined);
      const ensureVersionSpy = jest.spyOn(internalSvc, 'ensureCoreVersion').mockResolvedValue(
        '/usr/local/bin/xray',
      );
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(
        '/etc/nextpanel/nodes/chain-node-1.json.next-tested.json',
      );
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);

      const promise = internalSvc.deployChainExit(
        {
          id: 'node-1',
          exitPort: 15001,
          chainCredEnc: `enc:${JSON.stringify(chainCredentials)}`,
          egressIpPolicy: 'AUTO',
        },
        { ip: '1.2.3.4' },
        {
          id: 'exit-1',
          ip: '5.6.7.8',
          sshPort: 22,
          sshUser: 'root',
          sshAuthType: 'PASSWORD',
          sshAuthEnc: 'enc:exit-secret',
        },
        jest.fn(),
      );
      await jest.runAllTimersAsync();
      const deployment = await promise;

      expect(connectSpy).toHaveBeenCalled();
      expect(execSpy).toHaveBeenCalledWith('test -x /usr/local/bin/xray');
      expect(ensureVersionSpy).toHaveBeenCalledWith(
        expect.any(NodeSSH),
        '/usr/local/bin/xray',
        'XRAY',
        '25.3.6',
        expect.any(Function),
      );
      expect(generateChainExitConfig).toHaveBeenCalledWith(
        'node-1',
        15001,
        chainCredentials.uuid,
        '1.2.3.4',
        {
          privateKey: chainCredentials.realityPrivateKey,
          shortId: chainCredentials.shortId,
        },
        'AUTO',
      );
      expect(execSpy.mock.calls.some(
        (call: unknown[]) => String(call[0]).includes("ufw allow from '1.2.3.4'"),
      )).toBe(false);
      expect(disposeSpy).not.toHaveBeenCalled();

      await internalSvc.commitChainExitDeployment(deployment, jest.fn());

      expect(execSpy.mock.calls.some(
        (call: unknown[]) => String(call[0]).includes("ufw allow from '1.2.3.4'"),
      )).toBe(true);
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it('restores the previous chain exit when its replacement does not start', async () => {
      jest.spyOn(NodeSSH.prototype, 'connect').mockResolvedValue({} as NodeSSH);
      const execSpy = jest.spyOn(NodeSSH.prototype, 'execCommand').mockImplementation(
        async (command: string) => {
          if (command === 'systemctl is-active nextpanel-chain-node-1') {
            return { code: 3, stdout: 'failed', stderr: '' } as any;
          }
          return { code: 0, stdout: '', stderr: '' } as any;
        },
      );
      const disposeSpy = jest
        .spyOn(NodeSSH.prototype, 'dispose')
        .mockImplementation(() => undefined);
      jest.spyOn(internalSvc, 'ensureCoreVersion').mockResolvedValue('/usr/local/bin/xray');
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(
        '/etc/nextpanel/nodes/chain-node-1.json.next-tested.json',
      );
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);

      const promise = internalSvc.deployChainExit(
        {
          id: 'node-1',
          exitPort: 15001,
          chainCredEnc: 'enc:chain-uuid',
        },
        { ip: '1.2.3.4' },
        {
          id: 'exit-1',
          ip: '5.6.7.8',
          sshPort: 22,
          sshUser: 'root',
          sshAuthType: 'PASSWORD',
          sshAuthEnc: 'enc:exit-secret',
        },
        jest.fn(),
      );
      const rejection = expect(promise).rejects.toThrow('出口服务器链式服务启动失败');
      await jest.runAllTimersAsync();
      await rejection;

      const commands = execSpy.mock.calls.map((call: unknown[]) => String(call[0]));
      const restoreCommand = commands.find((command: string) => command.startsWith('failed=0;'));
      expect(restoreCommand).toContain(
        "cp -p -- '/etc/nextpanel/nodes/chain-node-1.json.rollback-",
      );
      expect(restoreCommand).toContain("systemctl start 'nextpanel-chain-node-1'");
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it('rolls the prepared exit back when the entry replacement fails', async () => {
      const chainNode = setupChainNode();
      const exitDeployment = { id: 'pending-exit' };
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(
        `/etc/nextpanel/nodes/${chainNode.id}.json.next-tested`,
      );
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);
      jest.spyOn(internalSvc, 'deployChainExit').mockResolvedValue(exitDeployment);
      const commitSpy = jest
        .spyOn(internalSvc, 'commitChainExitDeployment')
        .mockResolvedValue(undefined);
      const rollbackSpy = jest
        .spyOn(internalSvc, 'rollbackChainExitDeployment')
        .mockResolvedValue(true);
      mockExecCommand.mockImplementation(async (command: string) => {
        if (command === '/usr/local/bin/xray version 2>&1') {
          return { code: 0, stdout: 'Xray 26.2.6 (Xray, Penetrates Everything.)', stderr: '' };
        }
        if (command === `systemctl is-active nextpanel-${chainNode.id}`) {
          return { code: 3, stdout: 'failed', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      });

      const promise = svc.deploy(chainNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(commitSpy).not.toHaveBeenCalled();
      expect(rollbackSpy).toHaveBeenCalledWith(exitDeployment, expect.any(Function));
    });

    it('keeps both rollback points until deployment state is persisted', async () => {
      const chainNode = setupChainNode();
      const exitDeployment = { id: 'pending-exit' };
      jest.spyOn(internalSvc, 'stageAndValidateConfig').mockResolvedValue(
        `/etc/nextpanel/nodes/${chainNode.id}.json.next-tested`,
      );
      jest.spyOn(internalSvc, 'activateStagedConfig').mockResolvedValue(undefined);
      jest.spyOn(internalSvc, 'deployChainExit').mockResolvedValue(exitDeployment);
      const commitSpy = jest
        .spyOn(internalSvc, 'commitChainExitDeployment')
        .mockResolvedValue(undefined);
      const exitRollbackSpy = jest
        .spyOn(internalSvc, 'rollbackChainExitDeployment')
        .mockResolvedValue(true);
      const entryRollbackSpy = jest
        .spyOn(internalSvc, 'restoreDeploymentRollback')
        .mockResolvedValue(true);
      (mockPrisma.configSnapshot.create as jest.Mock)
        .mockRejectedValueOnce(new Error('database unavailable'))
        .mockResolvedValueOnce({});

      const promise = svc.deploy(chainNode.id);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.log).toContain('database unavailable');
      expect(commitSpy).not.toHaveBeenCalled();
      expect(entryRollbackSpy).toHaveBeenCalled();
      expect(exitRollbackSpy).toHaveBeenCalledWith(exitDeployment, expect.any(Function));
    });
  });
});
