import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { Injectable, Logger } from '@nestjs/common';
import { TestResult } from '../xray-test/xray-test.service';

const TEST_URL = 'http://www.gstatic.com/generate_204';
const SINGBOX_BINARY = process.platform === 'darwin'
  ? '/opt/homebrew/bin/sing-box'
  : '/usr/local/bin/sing-box';
const SOCKS_PORT_MIN = 30000;
const SOCKS_PORT_MAX = 39999;
const SINGBOX_STARTUP_MS = 2000;
const TEST_TIMEOUT_MS = 15000;

export interface SingboxNodeInfo {
  host: string;
  port: number;
  domain: string | null;
  credentials: Record<string, string>;
}

@Injectable()
export class SingboxTestService {
  private readonly logger = new Logger(SingboxTestService.name);

  async testHysteria2(node: SingboxNodeInfo): Promise<TestResult> {
    const testedAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const configPath = path.join('/tmp', `singbox-test-${id}.json`);
    const socksPort = await this.allocatePort();

    const config = this.buildClientConfig(node, socksPort);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const { proc, ready } = this.spawnSingbox(configPath);

    try {
      await this.waitForPort(socksPort, SINGBOX_STARTUP_MS, ready);
      const { reachable, latency, message } = await this.curlTest(socksPort);
      return { reachable, latency, message, testedAt };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { reachable: false, latency: -1, message: msg, testedAt };
    } finally {
      proc.kill('SIGKILL');
      fs.rmSync(configPath, { force: true });
    }
  }

  // ── Config builder ─────────────────────────────────────────────────────────

  private buildClientConfig(node: SingboxNodeInfo, socksPort: number): unknown {
    const outbound: Record<string, unknown> = {
      type: 'hysteria2',
      tag: 'proxy-out',
      server: node.host,
      server_port: node.port,
      password: node.credentials.password ?? '',
      tls: {
        enabled: true,
        insecure: true,
        ...(node.domain ? { server_name: node.domain } : {}),
      },
    };

    return {
      log: { level: 'error', timestamp: false },
      inbounds: [
        {
          type: 'socks',
          tag: 'socks-in',
          listen: '127.0.0.1',
          listen_port: socksPort,
        },
      ],
      outbounds: [outbound],
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private spawnSingbox(configPath: string): { proc: ChildProcess; ready: Promise<void> } {
    const child = spawn(SINGBOX_BINARY, ['run', '-c', configPath], {
      stdio: 'ignore',
      detached: false,
    });

    const ready = new Promise<void>((_, reject) => {
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(new Error(`sing-box 未安装（找不到 ${SINGBOX_BINARY}）`));
        } else {
          reject(new Error(`sing-box 启动失败：${err.message}`));
        }
      });
    });

    return { proc: child, ready };
  }

  private waitForPort(port: number, timeoutMs: number, spawnError: Promise<void>): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      // If spawn fails, reject immediately with the real error
      spawnError.catch(reject);

      const attempt = () => {
        if (Date.now() > deadline) {
          return reject(new Error('sing-box 启动超时'));
        }
        const s = net.createConnection({ host: '127.0.0.1', port });
        s.once('connect', () => { s.destroy(); resolve(); });
        s.once('error', () => { s.destroy(); setTimeout(attempt, 100); });
      };
      attempt();
    });
  }

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
            const exitCode: number | string | undefined =
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (err as any).code as number | string | undefined;
            if (exitCode === 7) {
              reason = '节点不可达（连接被拒绝）';
            } else if (exitCode === 28) {
              reason = '连接超时（节点无响应）';
            } else if (exitCode === 97) {
              reason = 'SOCKS5 代理不可用（sing-box 异常退出）';
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
