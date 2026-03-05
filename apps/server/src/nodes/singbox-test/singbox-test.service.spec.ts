import { SingboxTestService } from './singbox-test.service';

// Mock core modules so their properties are configurable
jest.mock('fs');
jest.mock('net');

// ── Shared fake node ──────────────────────────────────────────────────────────

const fakeNode = { host: '1.2.3.4', port: 8443, domain: null, credentials: { password: 'pass' } };

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SingboxTestService', () => {
  let service: SingboxTestService;

  beforeEach(() => {
    service = new SingboxTestService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildClientConfig (via testHysteria2 path)', () => {
    it('builds config with password and insecure TLS', async () => {
      const svc = service as unknown as {
        buildClientConfig(
          node: { host: string; port: number; domain: string | null; credentials: Record<string, string> },
          socksPort: number,
        ): unknown;
      };

      const cfg = svc.buildClientConfig(
        { host: '1.2.3.4', port: 8443, domain: null, credentials: { password: 'secret' } },
        30100,
      ) as {
        log: unknown;
        inbounds: Array<{ type: string; listen: string; listen_port: number }>;
        outbounds: Array<{ type: string; server: string; server_port: number; password: string; tls: Record<string, unknown> }>;
      };

      expect(cfg.inbounds[0]).toMatchObject({ type: 'socks', listen: '127.0.0.1', listen_port: 30100 });
      expect(cfg.outbounds[0]).toMatchObject({
        type: 'hysteria2', server: '1.2.3.4', server_port: 8443,
        password: 'secret', tls: { enabled: true, insecure: true },
      });
      expect(cfg.outbounds[0].tls).not.toHaveProperty('server_name');
    });

    it('includes server_name when domain is provided', () => {
      const svc = service as unknown as {
        buildClientConfig(
          node: { host: string; port: number; domain: string | null; credentials: Record<string, string> },
          socksPort: number,
        ): unknown;
      };

      const cfg = svc.buildClientConfig(
        { host: '1.2.3.4', port: 8443, domain: 'example.com', credentials: { password: 'pass' } },
        30200,
      ) as { outbounds: Array<{ tls: Record<string, unknown> }> };

      expect(cfg.outbounds[0].tls).toMatchObject({ enabled: true, insecure: true, server_name: 'example.com' });
    });

    it('falls back to empty string when password credential is missing', () => {
      const svc = service as unknown as {
        buildClientConfig(
          node: { host: string; port: number; domain: string | null; credentials: Record<string, string> },
          socksPort: number,
        ): unknown;
      };

      const cfg = svc.buildClientConfig(
        { host: '1.2.3.4', port: 8443, domain: null, credentials: {} },
        30300,
      ) as { outbounds: Array<{ password: string }> };

      expect(cfg.outbounds[0].password).toBe('');
    });
  });

  // ── testHysteria2 ─────────────────────────────────────────────────────────

  describe('testHysteria2', () => {
    let svc: SingboxTestService;
    let mockProc: { kill: jest.Mock };

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mockFs = require('fs');

    beforeEach(() => {
      svc = new SingboxTestService();
      mockProc = { kill: jest.fn() };
      jest.clearAllMocks();
      jest.spyOn(svc as any, 'allocatePort').mockResolvedValue(30100);
      jest.spyOn(svc as any, 'spawnSingbox').mockReturnValue({ proc: mockProc, ready: Promise.resolve() });
      jest.spyOn(svc as any, 'waitForPort').mockResolvedValue(undefined);
      jest.spyOn(svc as any, 'curlTest').mockResolvedValue({ reachable: true, latency: 50, message: '连接成功，延迟 50ms' });
    });

    afterEach(() => jest.restoreAllMocks());

    it('writes config, spawns sing-box, runs curl test and returns result', async () => {
      const result = await svc.testHysteria2(fakeNode);

      expect(result.reachable).toBe(true);
      expect(result.latency).toBe(50);
      expect(result.testedAt).toBeDefined();
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/singbox-test-'), expect.any(String), 'utf8',
      );
      expect(mockFs.rmSync).toHaveBeenCalled();
      expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('returns reachable=false with error message when waitForPort throws', async () => {
      jest.spyOn(svc as any, 'waitForPort').mockRejectedValue(new Error('sing-box 未安装（找不到 binary）'));

      const result = await svc.testHysteria2(fakeNode);

      expect(result.reachable).toBe(false);
      expect(result.latency).toBe(-1);
      expect(result.message).toContain('sing-box 未安装');
      expect(mockProc.kill).toHaveBeenCalledWith('SIGKILL');
      expect(mockFs.rmSync).toHaveBeenCalled();
    });

    it('returns reachable=false when curlTest indicates failure', async () => {
      jest.spyOn(svc as any, 'curlTest').mockResolvedValue({ reachable: false, latency: -1, message: '连接失败：节点不可达' });

      const result = await svc.testHysteria2(fakeNode);

      expect(result.reachable).toBe(false);
      expect(result.message).toContain('节点不可达');
    });
  });

  // ── curlTest ──────────────────────────────────────────────────────────────

  describe('curlTest', () => {
    let svc: SingboxTestService;

    beforeEach(() => {
      svc = new SingboxTestService();
    });

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
      const result = await (svc as any).curlTest(30100);
      expect(result.reachable).toBe(true);
      expect(result.message).toContain('连接成功');
    });

    it('returns reachable=false with HTTP reason when no error but wrong code', async () => {
      mockExecFile(null, '403');
      const result = await (svc as any).curlTest(30100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain('HTTP 403');
    });

    it('returns reachable=false with 无响应 when no error and empty stdout', async () => {
      mockExecFile(null, '');
      const result = await (svc as any).curlTest(30100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain('无响应');
    });

    it.each([
      [7, '节点不可达'],
      [28, '连接超时'],
      [97, 'SOCKS5'],
      [56, '代理连接被重置'],
    ])('returns reachable=false with code %d reason', async (code, expected) => {
      const err = Object.assign(new Error('curl failed'), { code });
      mockExecFile(err, '');
      const result = await (svc as any).curlTest(30100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain(expected);
    });

    it('returns reachable=false with string error code reason', async () => {
      const err = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
      mockExecFile(err, '');
      const result = await (svc as any).curlTest(30100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain('curl 启动失败');
    });

    it('returns reachable=false with generic message for unknown numeric code', async () => {
      const err = Object.assign(new Error('curl failed'), { code: 99 });
      mockExecFile(err, '');
      const result = await (svc as any).curlTest(30100);
      expect(result.reachable).toBe(false);
      expect(result.message).toContain('代理错误');
    });
  });

  // ── allocatePort ──────────────────────────────────────────────────────────

  describe('allocatePort', () => {
    let svc: SingboxTestService;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mockNet = require('net');

    beforeEach(() => {
      svc = new SingboxTestService();
      jest.clearAllMocks();
    });

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
          if (_event === 'error') cb(); // always fire error callback
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
    let svc: SingboxTestService;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mockNet = require('net');

    beforeEach(() => {
      svc = new SingboxTestService();
      jest.clearAllMocks();
    });

    it('resolves when socket connects successfully', async () => {
      const mockSocket = {
        once: jest.fn((event: string, cb: () => void) => {
          if (event === 'connect') cb(); // fire connect immediately
        }),
        destroy: jest.fn(),
      };
      (mockNet.createConnection as jest.Mock).mockReturnValue(mockSocket);

      await expect((svc as any).waitForPort(30100, 5000, Promise.resolve())).resolves.toBeUndefined();
    });

    it('rejects immediately when spawnError rejects', async () => {
      const mockSocket = {
        once: jest.fn(), // never fires
        destroy: jest.fn(),
      };
      (mockNet.createConnection as jest.Mock).mockReturnValue(mockSocket);

      const spawnError = Promise.reject(new Error('sing-box 未安装'));
      await expect((svc as any).waitForPort(30100, 5000, spawnError)).rejects.toThrow('sing-box 未安装');
    });

    it('rejects with timeout error when deadline is exceeded', async () => {
      const mockSocket = {
        once: jest.fn((_event: string, cb: () => void) => {
          if (_event === 'error') cb(); // always fire error → retries until deadline
        }),
        destroy: jest.fn(),
      };
      (mockNet.createConnection as jest.Mock).mockReturnValue(mockSocket);

      // timeoutMs=0 so deadline is exceeded after first retry
      await expect((svc as any).waitForPort(30100, 0, Promise.resolve())).rejects.toThrow('sing-box 启动超时');
    });
  });

  // ── spawnSingbox ──────────────────────────────────────────────────────────

  describe('spawnSingbox', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns proc and ready promise that rejects on ENOENT', () => {
      const svc = new SingboxTestService();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cp = require('child_process');
      const mockChild = { on: jest.fn() };
      jest.spyOn(cp, 'spawn').mockReturnValue(mockChild);

      const { proc, ready } = (svc as any).spawnSingbox('/tmp/test.json');

      expect(proc).toBe(mockChild);

      // Trigger ENOENT error
      const onErrorCb = mockChild.on.mock.calls.find((c: unknown[]) => c[0] === 'error')?.[1] as
        | ((err: NodeJS.ErrnoException) => void)
        | undefined;
      const enoentErr = Object.assign(new Error('binary not found'), { code: 'ENOENT' });
      onErrorCb?.(enoentErr);

      return expect(ready).rejects.toThrow('sing-box 未安装');
    });

    it('ready rejects with generic message for non-ENOENT spawn errors', () => {
      const svc = new SingboxTestService();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cp = require('child_process');
      const mockChild = { on: jest.fn() };
      jest.spyOn(cp, 'spawn').mockReturnValue(mockChild);

      const { ready } = (svc as any).spawnSingbox('/tmp/test.json');

      const onErrorCb = mockChild.on.mock.calls.find((c: unknown[]) => c[0] === 'error')?.[1] as
        | ((err: NodeJS.ErrnoException) => void)
        | undefined;
      const otherErr = Object.assign(new Error('permission denied'), { code: 'EACCES' });
      onErrorCb?.(otherErr);

      return expect(ready).rejects.toThrow('sing-box 启动失败');
    });
  });
});
