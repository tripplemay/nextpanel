import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SingboxTestService } from '../singbox-test/singbox-test.service';
import { buildXrayClientConfig } from './config-builder';

export interface TestResult {
  reachable: boolean;
  latency: number;
  message: string;
  testedAt: string;
}

const TEST_URL = 'http://www.gstatic.com/generate_204';
const XRAY_BINARY = process.platform === 'darwin'
  ? '/opt/homebrew/bin/xray'
  : '/usr/local/bin/xray';
const SOCKS_PORT_MIN = 20000;
const SOCKS_PORT_MAX = 29999;
const MAX_CONCURRENT = 5;
const XRAY_STARTUP_MS = 1500;
const TEST_TIMEOUT_MS = 15000;

@Injectable()
export class XrayTestService {
  private readonly logger = new Logger(XrayTestService.name);

  // Simple semaphore: queue of resolve functions waiting for a slot
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly singboxTest: SingboxTestService,
  ) {}

  async testNode(nodeId: string): Promise<TestResult> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: { select: { ip: true } } },
    });
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);

    const credentials = JSON.parse(
      this.crypto.decrypt(node.credentialsEnc),
    ) as Record<string, string>;

    let result: TestResult;

    // Hysteria2 is not supported by Xray — delegate to sing-box test
    if (node.protocol === 'HYSTERIA2') {
      result = await this.withSemaphore(() =>
        this.singboxTest.testHysteria2({
          host: node.domain ?? node.server.ip,
          port: node.listenPort,
          domain: node.domain,
          credentials,
        }),
      );
    } else {
      result = await this.withSemaphore(() =>
        this.runTest({
          protocol: node.protocol,
          transport: node.transport,
          tls: node.tls,
          host: node.domain ?? node.server.ip,
          port: node.listenPort,
          domain: node.domain,
          credentials,
        }),
      );
    }

    // Persist result — fire-and-forget, never block the caller
    this.prisma.node.update({
      where: { id: nodeId },
      data: {
        lastReachable: result.reachable,
        lastLatency: result.reachable ? result.latency : null,
        lastTestedAt: new Date(result.testedAt),
      },
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to persist test result for node ${nodeId}: ${msg}`);
    });

    return result;
  }

  // ── Semaphore ──────────────────────────────────────────────────────────────

  private withSemaphore<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const tryRun = () => {
        if (this.running < MAX_CONCURRENT) {
          this.running++;
          fn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
              this.running--;
              if (this.queue.length > 0) {
                const next = this.queue.shift()!;
                next();
              }
            });
        } else {
          this.queue.push(tryRun);
        }
      };
      tryRun();
    });
  }

  /** Public entry point for testing without a DB record (e.g., ExternalNode). */
  testWithParams(params: {
    protocol: string;
    transport: string | null;
    tls: string;
    host: string;
    port: number;
    domain: string | null;
    credentials: Record<string, string>;
  }): Promise<TestResult> {
    return this.withSemaphore(() => this.runTest(params));
  }

  // ── Core test logic ────────────────────────────────────────────────────────

  private async runTest(node: {
    protocol: string;
    transport: string | null;
    tls: string;
    host: string;
    port: number;
    domain: string | null;
    credentials: Record<string, string>;
  }): Promise<TestResult> {
    const testedAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const configPath = path.join('/tmp', `xray-test-${id}.json`);
    const socksPort = await this.allocatePort();

    const config = buildXrayClientConfig(
      {
        protocol: node.protocol,
        transport: node.transport,
        tls: node.tls,
        host: node.host,
        port: node.port,
        domain: node.domain,
        credentials: node.credentials,
      },
      socksPort,
    );

    fs.writeFileSync(configPath, config, 'utf8');

    const xray = this.spawnXray(configPath);

    try {
      await this.waitForPort(socksPort, XRAY_STARTUP_MS);
      const { reachable, latency, message } = await this.curlTest(socksPort);
      return { reachable, latency, message, testedAt };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { reachable: false, latency: -1, message: msg, testedAt };
    } finally {
      xray.kill('SIGKILL');
      fs.rmSync(configPath, { force: true });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private spawnXray(configPath: string) {
    const child = require('child_process').spawn(XRAY_BINARY, ['run', '-c', configPath], {
      stdio: 'ignore',
      detached: false,
    });
    child.on('error', (err: Error) => {
      this.logger.warn(`Xray spawn error: ${err.message}`);
    });
    return child;
  }

  /** Wait until the SOCKS5 port accepts TCP connections, or throw on timeout. */
  private waitForPort(port: number, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (Date.now() > deadline) {
          return reject(new Error('Xray 启动超时'));
        }
        const s = net.createConnection({ host: '127.0.0.1', port });
        s.once('connect', () => { s.destroy(); resolve(); });
        s.once('error', () => { s.destroy(); setTimeout(attempt, 100); });
      };
      attempt();
    });
  }

  /** Make a test request through the SOCKS5 proxy using curl. */
  private curlTest(socksPort: number): Promise<{ reachable: boolean; latency: number; message: string }> {
    return new Promise((resolve) => {
      const start = Date.now();
      execFile(
        'curl',
        [
          '-s',
          '-o', '/dev/null',
          '-w', '%{http_code}',
          '--socks5-hostname', `127.0.0.1:${socksPort}`,
          '--max-time', String(TEST_TIMEOUT_MS / 1000),
          '--connect-timeout', '10',
          TEST_URL,
        ],
        { timeout: TEST_TIMEOUT_MS + 2000 },
        (err, stdout) => {
          const latency = Date.now() - start;
          const httpCode = (stdout ?? '').trim();
          if (!err && httpCode === '204') {
            resolve({ reachable: true, latency, message: `连接成功，延迟 ${latency}ms` });
            return;
          }
          let reason: string;
          if (err) {
            // execFile errors: numeric exit code from child process, or string code from spawn failures
            const exitCode: number | string | undefined =
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (err as any).code as number | string | undefined;
            if (exitCode === 7) {
              reason = '节点不可达（代理连接被拒绝或认证失败）';
            } else if (exitCode === 28) {
              reason = '连接超时（节点无响应）';
            } else if (exitCode === 52) {
              reason = '服务端无响应（REALITY 握手失败或密钥不匹配）';
            } else if (exitCode === 97) {
              reason = 'SOCKS5 代理不可用（Xray 异常退出）';
            } else if (exitCode === 56) {
              reason = '代理连接被重置';
            } else if (typeof exitCode === 'string') {
              reason = `curl 启动失败（${exitCode}）`;
            } else {
              reason = `代理错误（curl 退出码 ${String(exitCode)}）`;
            }
          } else {
            reason = `HTTP ${httpCode || '无响应'}`;
          }
          resolve({ reachable: false, latency: -1, message: `连接失败：${reason}` });
        },
      );
    });
  }

  /** Pick a random available port in [SOCKS_PORT_MIN, SOCKS_PORT_MAX]. */
  private allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const attempt = (tries: number) => {
        if (tries === 0) return reject(new Error('无可用端口'));
        const port =
          Math.floor(Math.random() * (SOCKS_PORT_MAX - SOCKS_PORT_MIN + 1)) +
          SOCKS_PORT_MIN;
        const s = net.createServer();
        s.once('error', () => attempt(tries - 1));
        s.listen(port, '127.0.0.1', () => {
          s.close(() => resolve(port));
        });
      };
      attempt(20);
    });
  }
}
