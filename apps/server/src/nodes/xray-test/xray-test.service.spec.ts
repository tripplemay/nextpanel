import { NotFoundException } from '@nestjs/common';
import { XrayTestService } from './xray-test.service';
import { PrismaService } from '../../prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SingboxTestService } from '../singbox-test/singbox-test.service';

// Mock core modules so their properties are configurable
jest.mock('fs');
jest.mock('net');
jest.mock('./config-builder', () => ({ buildXrayClientConfig: jest.fn().mockReturnValue('{"config":true}') }));

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  node: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaService;

const mockCrypto = {
  decrypt: jest.fn((s: string) => s),
} as unknown as CryptoService;

const mockSingbox = {
  testHysteria2: jest.fn(),
} as unknown as SingboxTestService;

// ── Helpers ──────────────────────────────────────────────────────────────────

const fakeResult = { reachable: true, latency: 120, message: '连接成功，延迟 120ms', testedAt: '2026-01-01T00:00:00.000Z' };

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    protocol: 'VMESS',
    transport: 'TCP',
    tls: 'NONE',
    listenPort: 10086,
    domain: null,
    credentialsEnc: JSON.stringify({ uuid: 'test-uuid' }),
    server: { ip: '1.2.3.4' },
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('XrayTestService', () => {
  let svc: XrayTestService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new XrayTestService(mockPrisma, mockCrypto, mockSingbox);
    // Silence logger
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  });

  describe('testNode — node not found', () => {
    it('throws NotFoundException when node does not exist', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.testNode('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('testNode — HYSTERIA2 delegates to sing-box', () => {
    it('calls singboxTest.testHysteria2 and persists result', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(
        makeNode({ protocol: 'HYSTERIA2', credentialsEnc: JSON.stringify({ password: 'pass' }) }),
      );
      (mockSingbox.testHysteria2 as jest.Mock).mockResolvedValue(fakeResult);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});

      const result = await svc.testNode('node-1');

      expect(mockSingbox.testHysteria2).toHaveBeenCalledWith(
        expect.objectContaining({ host: '1.2.3.4', port: 10086, credentials: { password: 'pass' } }),
      );
      expect(result.reachable).toBe(true);
      expect(result.latency).toBe(120);
    });

    it('persists failure result when sing-box returns reachable=false', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(
        makeNode({ protocol: 'HYSTERIA2', credentialsEnc: JSON.stringify({ password: 'pass' }) }),
      );
      const failResult = { ...fakeResult, reachable: false, latency: -1 };
      (mockSingbox.testHysteria2 as jest.Mock).mockResolvedValue(failResult);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});

      const result = await svc.testNode('node-1');

      expect(result.reachable).toBe(false);
      expect(mockPrisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastReachable: false, lastLatency: null }),
        }),
      );
    });
  });

  describe('testNode — non-HYSTERIA2 path (runTest)', () => {
    it('calls runTest for VMESS protocol and returns result', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(makeNode());
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});

      // Spy on the private runTest to avoid real process/network calls
      jest.spyOn(svc as any, 'runTest').mockResolvedValue(fakeResult);

      const result = await svc.testNode('node-1');

      expect((svc as any).runTest).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: 'VMESS', host: '1.2.3.4', port: 10086 }),
      );
      expect(result.reachable).toBe(true);
    });
  });

  describe('testNode — persistence', () => {
    it('persists lastLatency when reachable', async () => {
      // Use HYSTERIA2 path (simpler to mock end-to-end)
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(
        makeNode({ protocol: 'HYSTERIA2', credentialsEnc: JSON.stringify({ password: 'pass' }) }),
      );
      (mockSingbox.testHysteria2 as jest.Mock).mockResolvedValue(fakeResult);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});

      await svc.testNode('node-1');

      expect(mockPrisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'node-1' },
          data: expect.objectContaining({ lastReachable: true, lastLatency: 120 }),
        }),
      );
    });

    it('does not throw if persistence fails (fire-and-forget)', async () => {
      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(
        makeNode({ protocol: 'HYSTERIA2', credentialsEnc: JSON.stringify({ password: 'pass' }) }),
      );
      (mockSingbox.testHysteria2 as jest.Mock).mockResolvedValue(fakeResult);
      (mockPrisma.node.update as jest.Mock).mockRejectedValue(new Error('db error'));

      // Should resolve without throwing even if update fails
      await expect(svc.testNode('node-1')).resolves.toBeDefined();
    });
  });

  describe('semaphore — concurrency limiting', () => {
    it('runs up to MAX_CONCURRENT tasks simultaneously and queues the rest', async () => {
      // 7 tasks: 5 should start immediately, 2 should be queued
      const resolvers: Array<() => void> = [];

      (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(
        makeNode({ protocol: 'HYSTERIA2', credentialsEnc: JSON.stringify({ password: 'pass' }) }),
      );
      (mockSingbox.testHysteria2 as jest.Mock).mockImplementation(
        () =>
          new Promise<typeof fakeResult>((resolve) => {
            resolvers.push(() => resolve(fakeResult));
          }),
      );
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});

      const promises = Array.from({ length: 7 }, () => svc.testNode('node-1'));

      // Let microtasks settle so the semaphore fills
      await new Promise((r) => setTimeout(r, 0));
      expect((svc as any).running).toBe(5);
      expect((svc as any).queue.length).toBe(2);

      // Resolve the first 5 — this unblocks the 2 queued tasks which will push 2 more resolvers
      resolvers.splice(0, 5).forEach((r) => r());
      // Wait for finally blocks and queued task starts
      await new Promise((r) => setTimeout(r, 0));
      // Resolve the remaining 2 resolvers from the queued tasks
      resolvers.splice(0).forEach((r) => r());

      await Promise.all(promises);
      expect((svc as any).running).toBe(0);
    });
  });

  // ── runTest ───────────────────────────────────────────────────────────────

  describe('runTest', () => {
    let svc2: XrayTestService;
    let mockProc: { kill: jest.Mock };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mockFs = require('fs');

    beforeEach(() => {
      svc2 = new XrayTestService(mockPrisma, mockCrypto, mockSingbox);
      mockProc = { kill: jest.fn() };
      jest.clearAllMocks();
      jest.spyOn(svc2 as any, 'allocatePort').mockResolvedValue(20100);
      jest.spyOn(svc2 as any, 'spawnXray').mockReturnValue(mockProc);
      jest.spyOn(svc2 as any, 'waitForPort').mockResolvedValue(undefined);
      jest.spyOn(svc2 as any, 'curlTest').mockResolvedValue({ reachable: true, latency: 80, message: '连接成功，延迟 80ms' });
    });

    afterEach(() => jest.restoreAllMocks());

    it('writes config, spawns xray, runs curl and returns success result', async () => {
      const nodeArg = { protocol: 'VMESS', transport: 'TCP', tls: 'NONE', host: '1.2.3.4', port: 10086, domain: null, credentials: { uuid: 'abc' } };
      const result = await (svc2 as any).runTest(nodeArg);

      expect(result.reachable).toBe(true);
      expect(result.latency).toBe(80);
      expect(result.testedAt).toBeDefined();
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/xray-test-'), expect.any(String), 'utf8',
      );
      expect(mockFs.rmSync).toHaveBeenCalled();
      expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('returns reachable=false with error message when waitForPort throws', async () => {
      jest.spyOn(svc2 as any, 'waitForPort').mockRejectedValue(new Error('Xray 启动超时'));

      const nodeArg = { protocol: 'VMESS', transport: 'TCP', tls: 'NONE', host: '1.2.3.4', port: 10086, domain: null, credentials: {} };
      const result = await (svc2 as any).runTest(nodeArg);

      expect(result.reachable).toBe(false);
      expect(result.latency).toBe(-1);
      expect(result.message).toContain('Xray 启动超时');
      expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL');
      expect(mockFs.rmSync).toHaveBeenCalled();
    });
  });

  // ── curlTest ──────────────────────────────────────────────────────────────

  describe('curlTest', () => {
    afterEach(() => jest.restoreAllMocks());

    function mockExecFile(err: Error | null, stdout: string) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cp = require('child_process');
      jest.spyOn(cp, 'execFile').mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (...args: any[]) => {
          const cb = args[args.length - 1] as (e: Error | null, out: string) => void;
          cb(err, stdout);
          return {} as ReturnType<typeof cp.execFile>;
        },
      );
    }

    it('returns reachable=true when http code is 204', async () => {
      mockExecFile(null, '204');
      const result = await (svc as any).curlTest(20100);
      expect(result.reachable).toBe(true);
      expect(result.message).toContain('连接成功');
    });

    it('returns reachable=false with HTTP reason when no error but wrong code', async () => {
      mockExecFile(null, '403');
      const result = await (svc as any).curlTest(20100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain('HTTP 403');
    });

    it('returns reachable=false with 无响应 when no error and empty stdout', async () => {
      mockExecFile(null, '');
      const result = await (svc as any).curlTest(20100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain('无响应');
    });

    it.each([
      [7, '节点不可达'],
      [28, '连接超时'],
      [52, 'REALITY'],
      [97, 'SOCKS5'],
      [56, '代理连接被重置'],
    ])('returns reachable=false with code %d reason', async (code, expected) => {
      const err = Object.assign(new Error('curl failed'), { code });
      mockExecFile(err, '');
      const result = await (svc as any).curlTest(20100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain(expected);
    });

    it('returns reachable=false with string error code reason', async () => {
      const err = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
      mockExecFile(err, '');
      const result = await (svc as any).curlTest(20100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain('curl 启动失败');
    });

    it('returns reachable=false with generic message for unknown numeric code', async () => {
      const err = Object.assign(new Error('curl failed'), { code: 99 });
      mockExecFile(err, '');
      const result = await (svc as any).curlTest(20100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain('代理错误');
    });
  });

  // ── allocatePort ──────────────────────────────────────────────────────────

  describe('allocatePort', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mockNet = require('net');

    beforeEach(() => jest.clearAllMocks());

    it('resolves with a port number when server binds successfully', async () => {
      const mockServer = {
        once: jest.fn(),
        listen: jest.fn((_port: number, _host: string, cb: () => void) => cb()),
        close: jest.fn((cb: () => void) => cb()),
      };
      (mockNet.createServer as jest.Mock).mockReturnValue(mockServer);

      const port = await (svc as any).allocatePort();

      expect(typeof port).toBe('number');
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('rejects with 无可用端口 when all retry attempts fail', async () => {
      const mockServer = {
        once: jest.fn((_event: string, cb: () => void) => {
          if (_event === 'error') cb();
        }),
        listen: jest.fn(),
        close: jest.fn(),
      };
      (mockNet.createServer as jest.Mock).mockReturnValue(mockServer);

      await expect((svc as any).allocatePort()).rejects.toThrow('无可用端口');
    });
  });

  // ── waitForPort ───────────────────────────────────────────────────────────

  describe('waitForPort', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mockNet = require('net');

    beforeEach(() => jest.clearAllMocks());

    it('resolves when socket connects successfully', async () => {
      const mockSocket = {
        once: jest.fn((event: string, cb: () => void) => {
          if (event === 'connect') cb();
        }),
        destroy: jest.fn(),
      };
      (mockNet.createConnection as jest.Mock).mockReturnValue(mockSocket);

      await expect((svc as any).waitForPort(20100, 5000)).resolves.toBeUndefined();
    });

    it('rejects with timeout error when deadline is exceeded', async () => {
      const mockSocket = {
        once: jest.fn((_event: string, cb: () => void) => {
          if (_event === 'error') cb(); // always error → retries until deadline
        }),
        destroy: jest.fn(),
      };
      (mockNet.createConnection as jest.Mock).mockReturnValue(mockSocket);

      // Very short timeout to trigger deadline exceeded path
      await expect((svc as any).waitForPort(20100, 0)).rejects.toThrow('Xray 启动超时');
    });
  });

  // ── spawnXray ─────────────────────────────────────────────────────────────

  describe('spawnXray', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns child process and logs spawn errors via logger.warn', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cp = require('child_process');
      const mockChild = { on: jest.fn() };
      jest.spyOn(cp, 'spawn').mockReturnValue(mockChild);
      jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

      const child = (svc as any).spawnXray('/tmp/xray-test-abc.json');

      expect(child).toBe(mockChild);
      expect(cp.spawn).toHaveBeenCalledWith(
        expect.stringContaining('xray'),
        ['run', '-c', '/tmp/xray-test-abc.json'],
        expect.any(Object),
      );

      // Trigger error handler to cover warn logging
      const onErrorCb = mockChild.on.mock.calls.find((c: unknown[]) => c[0] === 'error')?.[1] as
        | ((err: Error) => void)
        | undefined;
      onErrorCb?.(new Error('spawn failed'));

      expect((svc as any).logger.warn).toHaveBeenCalledWith(expect.stringContaining('spawn failed'));
    });
  });
});
