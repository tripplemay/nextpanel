import * as crypto from 'crypto';
import { Injectable, Logger, MessageEvent, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from '../nodes/node-deploy.service';
import { connectSsh } from '../nodes/ssh/ssh.util';

@Injectable()
export class AutoSetupService {
  private readonly logger = new Logger(AutoSetupService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private nodeDeploy: NodeDeployService,
  ) {}

  setupStream(
    serverId: string,
    templateIds: string[],
    actorId?: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const emit = (log: string) =>
        subscriber.next({ data: { log } } as MessageEvent);

      this.run(serverId, templateIds, emit, actorId)
        .then((success) => {
          subscriber.next({ data: { done: true, success } } as MessageEvent);
          subscriber.complete();
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          emit(`[ERROR] ${msg}`);
          subscriber.next({ data: { done: true, success: false } } as MessageEvent);
          subscriber.complete();
        });
    });
  }

  private async run(
    serverId: string,
    templateIds: string[],
    log: (msg: string) => void,
    actorId?: string,
  ): Promise<boolean> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);

    const sshAuth = this.crypto.decrypt(server.sshAuthEnc);

    log(`=== 开始自动配置服务器: ${server.name} (${server.ip}) ===`);

    // ── 1. SSH connect ────────────────────────────────────────────────────────
    log('正在建立 SSH 连接...');
    const ssh = await connectSsh({
      host: server.ip,
      port: server.sshPort,
      username: server.sshUser,
      authType: server.sshAuthType as 'KEY' | 'PASSWORD',
      auth: sshAuth,
      readyTimeout: 15000,
    });
    log(`SSH 已连接到 ${server.ip}:${server.sshPort}`);

    let occupiedPorts: Set<number>;
    try {
      // ── 2. Detect occupied ports ────────────────────────────────────────────
      log('检测已占用端口...');
      occupiedPorts = await this.detectOccupiedPorts(ssh, log);
    } finally {
      ssh.dispose();
    }

    if (templateIds.length === 0) {
      log('未选择模板，跳过节点创建。');
      return true;
    }

    // ── 3. Load templates ─────────────────────────────────────────────────────
    const templates = await this.prisma.template.findMany({
      where: { id: { in: templateIds } },
    });
    if (templates.length === 0) {
      log('未找到所选模板，跳过节点创建。');
      return true;
    }

    // ── 4. Create nodes for each template ─────────────────────────────────────
    const allocatedPorts = new Set<number>();
    const nodeIds: string[] = [];

    for (const tpl of templates) {
      const port = this.allocatePort(occupiedPorts, allocatedPorts);
      allocatedPorts.add(port);

      const credentials = generateCredentials(tpl.protocol);
      const credentialsEnc = this.crypto.encrypt(JSON.stringify(credentials));

      const node = await this.prisma.node.create({
        data: {
          serverId,
          name: `${tpl.name}`,
          protocol: tpl.protocol,
          implementation: tpl.implementation ?? 'XRAY',
          transport: 'TCP',
          tls: 'NONE',
          listenPort: port,
          credentialsEnc,
          source: 'AUTO',
          enabled: true,
        },
      });
      nodeIds.push(node.id);
      log(`已创建节点: ${node.name} — 端口 ${port} (协议: ${tpl.protocol})`);
    }

    // ── 5. Deploy each node ───────────────────────────────────────────────────
    let allSuccess = true;
    for (const nodeId of nodeIds) {
      log(`\n--- 部署节点 ${nodeId} ---`);
      const result = await this.nodeDeploy.deploy(nodeId, log, actorId);
      if (!result.success) {
        allSuccess = false;
        log(`节点 ${nodeId} 部署失败`);
      }
    }

    log(`\n=== 自动配置完成 (${allSuccess ? '全部成功' : '部分失败'}) ===`);
    return allSuccess;
  }

  private async detectOccupiedPorts(
    ssh: import('node-ssh').NodeSSH,
    log: (msg: string) => void,
  ): Promise<Set<number>> {
    const occupied = new Set<number>();
    try {
      const { stdout } = await ssh.execCommand(
        `ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo ""`,
      );
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = /[:\s](\d{1,5})\s/.exec(line);
        if (match) {
          const port = parseInt(match[1], 10);
          if (port > 0 && port <= 65535) occupied.add(port);
        }
      }
      log(`检测到 ${occupied.size} 个已占用端口`);
    } catch {
      log('端口检测失败，将从默认起始端口分配');
    }
    return occupied;
  }

  /** Find the next available port starting from 10000 */
  private allocatePort(
    occupied: Set<number>,
    allocated: Set<number>,
    start = 10000,
  ): number {
    for (let p = start; p < 65535; p++) {
      if (!occupied.has(p) && !allocated.has(p)) return p;
    }
    throw new Error('无可用端口');
  }
}

function generateCredentials(protocol: string): Record<string, string> {
  const proto = protocol.toUpperCase();
  if (proto === 'VLESS' || proto === 'VMESS') {
    return { uuid: crypto.randomUUID() };
  }
  if (proto === 'TROJAN') {
    return { password: crypto.randomBytes(16).toString('hex') };
  }
  if (proto === 'SHADOWSOCKS') {
    return {
      password: crypto.randomBytes(16).toString('hex'),
      method: 'aes-128-gcm',
    };
  }
  // Fallback: uuid
  return { uuid: crypto.randomUUID() };
}
