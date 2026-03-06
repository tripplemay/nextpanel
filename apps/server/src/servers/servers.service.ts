import { Injectable, Logger, NotFoundException, MessageEvent } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from '../nodes/node-deploy.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
import { connectSsh } from '../nodes/ssh/ssh.util';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private nodeDeploy: NodeDeployService,
    private cfService: CloudflareService,
    private cfSettings: CloudflareSettingsService,
  ) {}

  async create(dto: CreateServerDto, userId: string) {
    const sshAuthEnc = this.crypto.encrypt(dto.sshAuth);
    return this.prisma.server.create({
      data: {
        userId,
        name: dto.name,
        region: dto.region,
        provider: dto.provider,
        ip: dto.ip,
        sshPort: dto.sshPort ?? 22,
        sshUser: dto.sshUser ?? 'root',
        sshAuthType: dto.sshAuthType,
        sshAuthEnc,
        tags: dto.tags ?? [],
        notes: dto.notes,
      },
      select: this.safeSelect(),
    });
  }

  async findAll(userId: string) {
    return this.prisma.server.findMany({
      where: { userId },
      select: this.safeSelect(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const server = await this.prisma.server.findFirst({
      where: { id, userId },
      select: this.safeSelect(),
    });
    if (!server) throw new NotFoundException(`Server ${id} not found`);
    return server;
  }

  async update(id: string, dto: UpdateServerDto, userId: string) {
    await this.findOne(id, userId);
    const data: Record<string, unknown> = { ...dto };
    if (dto.sshAuth) {
      data.sshAuthEnc = this.crypto.encrypt(dto.sshAuth);
      delete data.sshAuth;
    }
    return this.prisma.server.update({
      where: { id },
      data,
      select: this.safeSelect(),
    });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId);

    // Fetch all nodes on this server (need userId + cfDnsRecordId for cleanup)
    const nodes = await this.prisma.node.findMany({
      where: { serverId: id },
      select: { id: true, userId: true, cfDnsRecordId: true },
    });

    // Undeploy all nodes via SSH (best-effort — log errors but continue)
    await Promise.allSettled(
      nodes.map(async (node) => {
        try {
          await this.nodeDeploy.undeploy(node.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Server ${id}: undeploy of node ${node.id} failed during cascade: ${msg}`);
        }
      }),
    );

    // Clean up Cloudflare DNS records (best-effort)
    await Promise.allSettled(
      nodes
        .filter((n) => n.cfDnsRecordId && n.userId)
        .map(async (node) => {
          const settings = await this.cfSettings.getDecryptedToken(node.userId!).catch(() => null);
          if (!settings) return;
          try {
            await this.cfService.deleteRecord(settings.apiToken, settings.zoneId, node.cfDnsRecordId!);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Server ${id}: CF DNS cleanup for node ${node.id} failed: ${msg}`);
          }
        }),
    );

    // DB cascade: Node has onDelete:Cascade on Server, so all nodes are deleted automatically
    return this.prisma.server.delete({ where: { id } });
  }

  async checkIp(ip: string, userId: string): Promise<{ exists: boolean }> {
    const server = await this.prisma.server.findFirst({ where: { ip, userId } });
    return { exists: !!server };
  }

  async testSsh(id: string, userId: string): Promise<{ success: boolean; message: string }> {
    const server = await this.prisma.server.findFirst({ where: { id, userId } });
    if (!server) throw new NotFoundException(`Server ${id} not found`);

    const sshAuth = this.crypto.decrypt(server.sshAuthEnc);
    const ssh = new NodeSSH();

    try {
      const connectOpts: Parameters<NodeSSH['connect']>[0] = {
        host: server.ip,
        port: server.sshPort,
        username: server.sshUser,
        readyTimeout: 10000,
      };

      if (server.sshAuthType === 'KEY') {
        connectOpts.privateKey = sshAuth;
      } else {
        connectOpts.password = sshAuth;
      }

      await ssh.connect(connectOpts);
      const result = await ssh.execCommand('echo ok');
      ssh.dispose();

      return {
        success: result.stdout.trim() === 'ok',
        message: 'SSH connection successful',
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  installAgentStream(id: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const emit = (log: string) =>
        subscriber.next({ data: { log } } as MessageEvent);

      // Emit manualCmd upfront so the frontend can show it without waiting for failure
      const panelUrl = process.env.PANEL_URL ?? '';
      const githubRepo = process.env.GITHUB_REPO ?? '';
      this.prisma.server
        .findUnique({ where: { id }, select: { agentToken: true } })
        .then((server) => {
          if (server && panelUrl && githubRepo) {
            const manualCmd = `curl -fsSL https://raw.githubusercontent.com/${githubRepo}/main/apps/agent/install.sh | bash -s -- ${panelUrl} ${server.agentToken}`;
            subscriber.next({ data: { manualCmd } } as MessageEvent);
          }
        })
        .catch(() => { /* non-critical, ignore */ });

      this.installAgent(id, emit)
        .then((success) => {
          subscriber.next({ data: { done: true, success } } as MessageEvent);
          subscriber.complete();
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          emit(`错误: ${msg}`);
          subscriber.next({ data: { done: true, success: false } } as MessageEvent);
          subscriber.complete();
        });
    });
  }

  private async installAgent(id: string, onLog: (line: string) => void): Promise<boolean> {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException(`Server ${id} not found`);

    const panelUrl = process.env.PANEL_URL ?? '';
    const githubRepo = process.env.GITHUB_REPO ?? '';
    if (!panelUrl) throw new Error('未配置 PANEL_URL 环境变量');
    if (!githubRepo) throw new Error('未配置 GITHUB_REPO 环境变量');

    const sshAuth = this.crypto.decrypt(server.sshAuthEnc);

    onLog(`正在连接 ${server.ip}...`);
    const ssh = await connectSsh({
      host: server.ip,
      port: server.sshPort,
      username: server.sshUser,
      authType: server.sshAuthType as 'KEY' | 'PASSWORD',
      auth: sshAuth,
      readyTimeout: 15000,
    });

    try {
      // 检测是否已安装
      onLog('检测 Agent 运行状态...');
      const { code: activeCode } = await ssh.execCommand(
        'systemctl is-active nextpanel-agent',
      );
      const alreadyInstalled = activeCode === 0;
      if (alreadyInstalled) onLog('检测到已安装旧版 Agent，将升级到最新版本...');

      // BBR 网络优化（best-effort，失败不中断安装）
      onLog('检测 BBR 支持...');

      // Step 1: 已经在用 BBR 则直接跳过
      const { stdout: currentAlgo } = await ssh.execCommand(
        'sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null',
      );
      if (currentAlgo.trim() === 'bbr') {
        onLog('BBR 已启用（无需重复配置）');
      } else {
        // Step 2: 尝试加载 BBR 内核模块（模块存在但未加载时 grep 会误报不支持）
        await ssh.execCommand('modprobe tcp_bbr 2>/dev/null || true');

        // Step 3: 确认 BBR 现在是否可用
        const { code: bbrAvailable } = await ssh.execCommand(
          'grep -q bbr /proc/sys/net/ipv4/tcp_available_congestion_control',
        );
        if (bbrAvailable === 0) {
          // Step 4: 立即生效
          const { code: applyCode } = await ssh.execCommand(
            'sysctl -w net.core.default_qdisc=fq >/dev/null 2>&1' +
            ' && sysctl -w net.ipv4.tcp_congestion_control=bbr >/dev/null 2>&1',
          );
          if (applyCode === 0) {
            // Step 5: 持久化（避免重复写入）
            await ssh.execCommand(
              'grep -q "tcp_congestion_control=bbr" /etc/sysctl.conf' +
              ' || printf "net.core.default_qdisc=fq\\nnet.ipv4.tcp_congestion_control=bbr\\n" >> /etc/sysctl.conf',
            );
            // Step 6: 验证
            const { stdout: verified } = await ssh.execCommand(
              'sysctl -n net.ipv4.tcp_congestion_control',
            );
            onLog(`BBR 已启用（当前拥塞控制算法: ${verified.trim()}）`);
          } else {
            onLog('⚠ BBR 配置失败（可能为容器环境限制），已跳过');
          }
        } else {
          onLog('⚠ 当前系统不支持 BBR（内核版本 < 4.9 或容器环境限制），已跳过');
        }
      }

      // 检测架构
      onLog('检测系统架构...');
      const { stdout: arch } = await ssh.execCommand('uname -m');
      const archTrimmed = arch.trim();
      let binary: string;
      if (archTrimmed === 'x86_64') {
        binary = 'agent-linux-amd64';
      } else if (archTrimmed === 'aarch64') {
        binary = 'agent-linux-arm64';
      } else {
        throw new Error(`不支持的架构: ${archTrimmed}`);
      }
      onLog(`架构: ${archTrimmed} → 使用 ${binary}`);

      // 获取最新版本号
      onLog('获取最新 Release 版本...');
      const { stdout: latestJson } = await ssh.execCommand(
        `curl -sf "https://api.github.com/repos/${githubRepo}/releases/latest"`,
      );
      const tagMatch = latestJson.match(/"tag_name"\s*:\s*"([^"]+)"/);
      if (!tagMatch) throw new Error('无法获取 Release 版本号，请检查 GITHUB_REPO 配置');
      const tag = tagMatch[1];
      onLog(`最新版本: ${tag}`);

      // 下载二进制（先停服务释放文件锁）
      if (alreadyInstalled) {
        await ssh.execCommand('systemctl stop nextpanel-agent');
      }
      onLog('下载 Agent 二进制...');
      const downloadUrl = `https://github.com/${githubRepo}/releases/download/${tag}/${binary}`;
      const { code: dlCode, stderr: dlErr } = await ssh.execCommand(
        `curl -fsSL "${downloadUrl}" -o /usr/local/bin/nextpanel-agent && chmod +x /usr/local/bin/nextpanel-agent`,
      );
      if (dlCode !== 0) throw new Error(`下载失败: ${dlErr}`);
      onLog('二进制下载完成。');

      // 写入配置文件
      onLog('写入配置文件...');
      const configJson = JSON.stringify({
        serverUrl: panelUrl,
        agentToken: server.agentToken,
      });
      const b64Config = Buffer.from(configJson).toString('base64');
      await ssh.execCommand('mkdir -p /etc/nextpanel');
      await ssh.execCommand(
        `echo '${b64Config}' | base64 -d > /etc/nextpanel/agent.json`,
      );
      onLog('配置文件写入完成。');

      if (!alreadyInstalled) {
        // 首次安装：创建 systemd 服务
        onLog('创建 systemd 服务...');
        const serviceContent = [
          '[Unit]',
          'Description=NextPanel Agent',
          'After=network.target',
          '',
          '[Service]',
          'ExecStart=/usr/local/bin/nextpanel-agent',
          'Restart=always',
          'RestartSec=10',
          '',
          '[Install]',
          'WantedBy=multi-user.target',
        ].join('\n');
        const b64Service = Buffer.from(serviceContent).toString('base64');
        await ssh.execCommand(
          `echo '${b64Service}' | base64 -d > /etc/systemd/system/nextpanel-agent.service`,
        );
        await ssh.execCommand('systemctl daemon-reload');
        await ssh.execCommand('systemctl enable nextpanel-agent');
      }

      // 启动服务
      onLog(alreadyInstalled ? '重启 Agent 服务...' : '启动 Agent 服务...');
      const { code: startCode, stderr: startErr } = await ssh.execCommand(
        'systemctl start nextpanel-agent',
      );
      if (startCode !== 0) throw new Error(`启动失败: ${startErr}`);

      // 验证
      const { stdout: statusOut } = await ssh.execCommand(
        'systemctl status nextpanel-agent --no-pager',
      );
      onLog(statusOut);
      onLog('Agent 安装并启动成功！');
      return true;
    } finally {
      ssh.dispose();
    }
  }

  /** Returns a select object that excludes sshAuthEnc */
  private safeSelect() {
    return {
      id: true,
      name: true,
      region: true,
      provider: true,
      ip: true,
      sshPort: true,
      sshUser: true,
      sshAuthType: true,
      tags: true,
      notes: true,
      status: true,
      cpuUsage: true,
      memUsage: true,
      diskUsage: true,
      networkIn: true,
      networkOut: true,
      pingMs: true,
      lastSeenAt: true,
      agentVersion: true,
      agentToken: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}
