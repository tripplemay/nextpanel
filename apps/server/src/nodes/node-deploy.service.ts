import * as crypto from 'crypto';
import { Injectable, Logger, MessageEvent, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NodeSSH } from 'node-ssh';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { generateConfig, getBinaryCommand, NodeInfo } from './config/config-generator';
import { connectSsh, uploadText, binaryExists, whichBinary, detectPackageManager } from './ssh/ssh.util';

export interface DeployResult {
  success: boolean;
  log: string;
}

@Injectable()
export class NodeDeployService {
  private readonly logger = new Logger(NodeDeployService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private operationLog: OperationLogService,
  ) {}

  /** Stream deploy logs as SSE events */
  deployStream(nodeId: string, actorId?: string, correlationId?: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const onLog = (line: string) => {
        subscriber.next({ data: { log: line } } as MessageEvent);
      };

      this.deploy(nodeId, onLog, actorId, correlationId)
        .then((result) => {
          subscriber.next({
            data: { done: true, success: result.success },
          } as MessageEvent);
          subscriber.complete();
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`deployStream error for node ${nodeId}: ${msg}`);
          subscriber.next({
            data: { done: true, success: false },
          } as MessageEvent);
          subscriber.complete();
        });
    });
  }

  async deploy(nodeId: string, onLog?: (line: string) => void, actorId?: string, correlationId?: string): Promise<DeployResult> {
    const startMs = Date.now();
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);

    const logs: string[] = [];
    const log = (msg: string) => {
      const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
      logs.push(line);
      onLog?.(line);
    };

    // ── 1. Decrypt credentials ───────────────────────────────────────────────
    const credentials = JSON.parse(
      this.crypto.decrypt(node.credentialsEnc),
    ) as Record<string, string>;

    // ── 2. Generate config JSON ──────────────────────────────────────────────
    const nodeInfo: NodeInfo = {
      id: node.id,
      protocol: node.protocol,
      implementation: node.implementation,
      transport: node.transport,
      tls: node.tls,
      listenPort: node.listenPort,
      domain: node.domain,
    };
    const configJson = generateConfig(nodeInfo, credentials);
    const configPath = `/etc/nextpanel/nodes/${node.id}.json`;
    const serviceName = `nextpanel-${node.id}`;
    const { bin: defaultBin, args } = getBinaryCommand(nodeInfo);
    let bin = defaultBin;

    log(`Starting deployment for node: ${node.name}`);
    log(`Server: ${node.server.ip}:${node.server.sshPort}`);

    // ── 3. SSH connect ───────────────────────────────────────────────────────
    const server = node.server;
    const sshAuth = this.crypto.decrypt(server.sshAuthEnc);
    let ssh: NodeSSH | null = null;

    try {
      log(`Connecting via SSH...`);
      ssh = await connectSsh({
        host: server.ip,
        port: server.sshPort,
        username: server.sshUser,
        authType: server.sshAuthType as 'KEY' | 'PASSWORD',
        auth: sshAuth,
        readyTimeout: 10000,
      });
      log(`SSH connected to ${server.ip}:${server.sshPort}`);

      // ── 4. Check binary, auto-install if missing ──────────────────────────
      log(`Checking binary: ${bin}`);
      if (!(await binaryExists(ssh, bin))) {
        log(`Binary not found: ${bin}. Starting auto-install...`);
        const impl = (node.implementation ?? 'XRAY').toUpperCase();
        const resolvedBin = await this.autoInstall(ssh, impl, log);
        if (!resolvedBin) {
          log(`Auto-install failed. Please install the binary manually and retry.`);
          ssh.dispose();
          await this.finalize(nodeId, node.name, false, logs, configJson, actorId, startMs, correlationId);
          return { success: false, log: logs.join('\n') };
        }
        // Re-verify — use resolved path (may differ from default for ss-libev)
        if (!(await binaryExists(ssh, resolvedBin))) {
          log(`Binary still not found at ${resolvedBin} after install. Aborting.`);
          ssh.dispose();
          await this.finalize(nodeId, node.name, false, logs, configJson, actorId, startMs, correlationId);
          return { success: false, log: logs.join('\n') };
        }
        // Override bin if ss-libev resolved to a different path
        if (resolvedBin !== bin) {
          bin = resolvedBin;
          log(`Using resolved binary path: ${bin}`);
        }
        log(`Binary installed and verified: ${bin}`);
      } else {
        log(`Binary OK: ${bin}`);
      }

      // ── 5. Generate self-signed TLS cert if node uses TLS mode ───────────
      if (node.tls === 'TLS') {
        const certDir = '/etc/nextpanel/certs';
        const certFile = `${certDir}/${node.id}.crt`;
        const keyFile  = `${certDir}/${node.id}.key`;
        const cn = node.domain ?? node.server.ip;
        log(`Ensuring TLS certificate at ${certFile}...`);
        const { stderr: certErr } = await ssh.execCommand(
          `mkdir -p ${certDir} && ` +
          `[ -f ${certFile} ] || openssl req -x509 -newkey rsa:2048 ` +
          `-keyout ${keyFile} -out ${certFile} -days 3650 -nodes -subj "/CN=${cn}" 2>&1`,
        );
        if (certErr) log(`TLS cert warning: ${certErr}`);
        else log(`TLS certificate ready`);
      }

      // ── 6. Upload config file (base64 to avoid shell escaping issues) ──────
      log(`Uploading config to ${configPath}...`);
      await uploadText(ssh, configJson, configPath);
      log(`Config uploaded to ${configPath}`);

      // ── 7. Write systemd unit ──────────────────────────────────────────────
      const unitContent = buildSystemdUnit(node.name, bin, args);
      const unitPath = `/etc/systemd/system/${serviceName}.service`;
      log(`Writing systemd unit to ${unitPath}...`);
      await uploadText(ssh, unitContent, unitPath);
      log(`Systemd unit written`);

      // ── 8. Enable & restart service ────────────────────────────────────────
      log(`Reloading systemd daemon...`);
      const { stderr: reloadErr } = await ssh.execCommand('systemctl daemon-reload');
      if (reloadErr) log(`daemon-reload warning: ${reloadErr}`);

      log(`Starting service: ${serviceName}...`);
      const { stderr: startErr } = await ssh.execCommand(
        `systemctl enable --now ${serviceName} && systemctl restart ${serviceName}`,
      );
      if (startErr) log(`Start warning: ${startErr}`);

      // ── 9. Verify service is active ────────────────────────────────────────
      log(`Waiting for service to stabilize...`);
      await new Promise((r) => setTimeout(r, 2000));
      const { stdout: activeOut } = await ssh.execCommand(
        `systemctl is-active ${serviceName}`,
      );
      const isActive = activeOut.trim() === 'active';
      log(`Service status: ${activeOut.trim()}`);

      if (!isActive) {
        const { stdout: journalOut } = await ssh.execCommand(
          `journalctl -u ${serviceName} -n 30 --no-pager 2>&1 || true`,
        );
        if (journalOut?.trim()) log(`Service logs:\n${journalOut.trim()}`);
      }

      ssh.dispose();
      await this.finalize(nodeId, node.name, isActive, logs, configJson, actorId, startMs, correlationId);

      if (isActive) {
        log(`Deployment completed successfully!`);
      } else {
        log(`Deployment finished but service is not active. Check server logs.`);
      }

      return { success: isActive, log: logs.join('\n') };
    } catch (err: unknown) {
      ssh?.dispose();
      const msg = err instanceof Error ? err.message : String(err);
      log(`Deploy error: ${msg}`);
      await this.finalize(nodeId, node.name, false, logs, configJson, actorId, startMs, correlationId);
      return { success: false, log: logs.join('\n') };
    }
  }

  /** Stream undeploy logs via SSE and delete the node record when done */
  undeployStream(nodeId: string, actorId?: string, correlationId?: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const onLog = (line: string) => {
        subscriber.next({ data: { log: line } } as MessageEvent);
      };

      this.doUndeployWithLogs(nodeId, onLog, actorId, correlationId)
        .then(() => {
          subscriber.next({ data: { done: true, success: true } } as MessageEvent);
          subscriber.complete();
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`undeployStream error for node ${nodeId}: ${msg}`);
          onLog(`[${new Date().toLocaleTimeString()}] 删除失败: ${msg}`);
          subscriber.next({ data: { done: true, success: false } } as MessageEvent);
          subscriber.complete();
        });
    });
  }

  private async doUndeployWithLogs(
    nodeId: string,
    onLog: (line: string) => void,
    actorId?: string,
    correlationId?: string,
  ): Promise<void> {
    const startMs = Date.now();
    const log = (msg: string) => onLog(`[${new Date().toLocaleTimeString()}] ${msg}`);

    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) throw new NotFoundException(`节点 ${nodeId} 不存在`);

    const sshAuth = this.crypto.decrypt(node.server.sshAuthEnc);
    const serviceName = `nextpanel-${node.id}`;
    const undeployLogs: string[] = [];
    const trackLog = (msg: string) => {
      undeployLogs.push(msg);
      log(msg);
    };

    // ── Step 1: SSH cleanup — must succeed before DB deletion ─────────────────
    let ssh: NodeSSH | null = null;
    try {
      trackLog(`正在连接服务器 ${node.server.ip}:${node.server.sshPort}...`);
      ssh = await connectSsh({
        host: node.server.ip,
        port: node.server.sshPort,
        username: node.server.sshUser,
        authType: node.server.sshAuthType as 'KEY' | 'PASSWORD',
        auth: sshAuth,
        readyTimeout: 10000,
      });
      trackLog('SSH 已连接');

      trackLog(`正在停止服务 ${serviceName}...`);
      await ssh.execCommand(`systemctl stop ${serviceName}`);
      trackLog('服务已停止');

      trackLog('正在删除 systemd 单元和配置文件...');
      await ssh.execCommand(
        `systemctl disable ${serviceName}; ` +
          `rm -f /etc/systemd/system/${serviceName}.service /etc/nextpanel/nodes/${node.id}.json; ` +
          `systemctl daemon-reload`,
      );
      trackLog('服务器清理完成');
    } catch (err: unknown) {
      ssh?.dispose();
      const msg = err instanceof Error ? err.message : String(err);
      trackLog(`SSH 清理失败，节点记录已保留: ${msg}`);
      trackLog('请确认服务器可达后重试删除操作');
      // Save failed undeploy log before throwing
      await this.operationLog.createLog({
        resourceType: 'node',
        resourceId: node.id,
        resourceName: node.name,
        actorId: actorId ?? null,
        operation: 'UNDEPLOY',
        correlationId: correlationId ?? null,
        success: false,
        log: undeployLogs.join('\n'),
        durationMs: Date.now() - startMs,
      });
      throw new Error(`SSH 清理失败: ${msg}`);
    }
    ssh.dispose();

    // ── Step 2: DB deletion — only after SSH cleanup confirmed ────────────────
    trackLog('服务器清理已确认，正在从数据库删除节点记录...');
    // Save operation log BEFORE deleting the node (while nodeId is still valid)
    await this.operationLog.createLog({
      resourceType: 'node',
      resourceId: node.id,
      resourceName: node.name,
      actorId: actorId ?? null,
      operation: 'UNDEPLOY',
      correlationId: correlationId ?? null,
      success: true,
      log: undeployLogs.join('\n'),
      durationMs: Date.now() - startMs,
    });
    await this.prisma.node.delete({ where: { id: nodeId } });
    trackLog('节点已删除');
  }

  /** Remove service + config from the server when node is deleted */
  async undeploy(nodeId: string): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) return;

    const sshAuth = this.crypto.decrypt(node.server.sshAuthEnc);
    const serviceName = `nextpanel-${node.id}`;

    let ssh: NodeSSH | null = null;
    try {
      ssh = await connectSsh({
        host: node.server.ip,
        port: node.server.sshPort,
        username: node.server.sshUser,
        authType: node.server.sshAuthType as 'KEY' | 'PASSWORD',
        auth: sshAuth,
        readyTimeout: 10000,
      });
      await ssh.execCommand(
        `systemctl stop ${serviceName}; systemctl disable ${serviceName}; ` +
          `rm -f /etc/systemd/system/${serviceName}.service /etc/nextpanel/nodes/${node.id}.json; ` +
          `systemctl daemon-reload`,
      );
      ssh.dispose();
    } catch (err: unknown) {
      ssh?.dispose();
      // Re-throw so callers (NodesService.remove) know cleanup failed
      throw err;
    }
  }

  // ── Auto-install ─────────────────────────────────────────────────────────

  /** Returns the resolved binary path on success, null on failure */
  private async autoInstall(
    ssh: NodeSSH,
    impl: string,
    log: (msg: string) => void,
  ): Promise<string | null> {
    switch (impl) {
      case 'XRAY':     return (await this.installXray(ssh, log))     ? '/usr/local/bin/xray'    : null;
      case 'V2RAY':    return (await this.installV2Ray(ssh, log))    ? '/usr/local/bin/v2ray'   : null;
      case 'SING_BOX': return (await this.installSingBox(ssh, log))  ? '/usr/local/bin/sing-box': null;
      case 'SS_LIBEV': return this.installSsLibev(ssh, log);
      default:
        log(`Unknown implementation "${impl}", cannot auto-install.`);
        return null;
    }
  }

  private async installXray(ssh: NodeSSH, log: (msg: string) => void): Promise<boolean> {
    log(`Installing Xray via official script...`);
    // Download to tmp file first to avoid process substitution (<()) which sh/dash don't support
    const { stdout, stderr } = await ssh.execCommand(
      `curl -sL https://github.com/XTLS/Xray-install/raw/main/install-release.sh -o /tmp/install-xray.sh && ` +
      `bash /tmp/install-xray.sh install 2>&1; rm -f /tmp/install-xray.sh`,
    );
    if (stdout) log(stdout.trim());
    if (stderr) log(stderr.trim());
    const { code } = await ssh.execCommand(`test -x /usr/local/bin/xray`);
    if (code === 0) { log(`Xray installed successfully.`); return true; }
    log(`Xray install failed.`);
    return false;
  }

  private async installV2Ray(ssh: NodeSSH, log: (msg: string) => void): Promise<boolean> {
    log(`Installing V2Ray via official script...`);
    const { stdout, stderr } = await ssh.execCommand(
      `curl -sL https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh -o /tmp/install-v2ray.sh && ` +
      `bash /tmp/install-v2ray.sh 2>&1; rm -f /tmp/install-v2ray.sh`,
    );
    if (stdout) log(stdout.trim());
    if (stderr) log(stderr.trim());
    const { code } = await ssh.execCommand(`test -x /usr/local/bin/v2ray`);
    if (code === 0) { log(`V2Ray installed successfully.`); return true; }
    log(`V2Ray install failed.`);
    return false;
  }

  private async installSingBox(ssh: NodeSSH, log: (msg: string) => void): Promise<boolean> {
    log(`Detecting architecture...`);
    const { stdout: uname } = await ssh.execCommand(`uname -m`);
    const archMap: Record<string, string> = {
      x86_64: 'amd64',
      aarch64: 'arm64',
      armv7l: 'armv7',
    };
    const arch = archMap[uname.trim()] ?? 'amd64';
    log(`Architecture: ${uname.trim()} → ${arch}`);

    log(`Fetching latest sing-box version from GitHub...`);
    const { stdout: apiOut } = await ssh.execCommand(
      `curl -s https://api.github.com/repos/SagerNet/sing-box/releases/latest | grep '"tag_name"' | sed 's/.*"v\\(.*\\)".*/\\1/'`,
    );
    const version = apiOut.trim();
    if (!version) { log(`Failed to fetch sing-box version.`); return false; }
    log(`Latest version: ${version}`);

    const tarName = `sing-box-${version}-linux-${arch}.tar.gz`;
    const url = `https://github.com/SagerNet/sing-box/releases/download/v${version}/${tarName}`;
    log(`Downloading ${tarName}...`);

    const { stderr: dlErr } = await ssh.execCommand(
      `curl -fsSL -o /tmp/${tarName} "${url}" && ` +
      `tar xzf /tmp/${tarName} -C /tmp && ` +
      `mv /tmp/sing-box-${version}-linux-${arch}/sing-box /usr/local/bin/sing-box && ` +
      `chmod +x /usr/local/bin/sing-box && ` +
      `rm -rf /tmp/${tarName} /tmp/sing-box-${version}-linux-${arch}`,
    );
    if (dlErr) log(dlErr.trim());

    const { code } = await ssh.execCommand(`test -x /usr/local/bin/sing-box`);
    if (code === 0) { log(`sing-box installed successfully.`); return true; }
    log(`sing-box install failed.`);
    return false;
  }

  private async installSsLibev(ssh: NodeSSH, log: (msg: string) => void): Promise<string | null> {
    log(`Detecting package manager...`);
    const pm = await detectPackageManager(ssh);

    let installCmd: string;
    if (pm === 'apt') {
      log(`Package manager: apt`);
      installCmd = `DEBIAN_FRONTEND=noninteractive apt-get update -qq && apt-get install -y shadowsocks-libev`;
    } else if (pm === 'dnf') {
      log(`Package manager: dnf`);
      installCmd = `dnf install -y shadowsocks-libev`;
    } else if (pm === 'yum') {
      log(`Package manager: yum`);
      installCmd = `yum install -y epel-release && yum install -y shadowsocks-libev`;
    } else {
      log(`No supported package manager found (apt/dnf/yum).`);
      return null;
    }

    const { stdout, stderr } = await ssh.execCommand(`${installCmd} 2>&1`);
    if (stdout) log(stdout.slice(-500));
    if (stderr) log(stderr.slice(-200));

    // ss-server path varies by distro — resolve dynamically
    const resolvedPath = await whichBinary(ssh, 'ss-server');
    if (resolvedPath) {
      log(`ss-server installed at: ${resolvedPath}`);
      return resolvedPath;
    }
    log(`shadowsocks-libev install failed.`);
    return null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async finalize(
    nodeId: string,
    nodeName: string,
    success: boolean,
    logs: string[],
    configJson: string,
    actorId: string | undefined,
    startMs: number,
    correlationId?: string,
  ) {
    const last = await this.prisma.configSnapshot.findFirst({
      where: { nodeId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const checksum = crypto
      .createHash('sha256')
      .update(configJson)
      .digest('hex');

    await Promise.all([
      this.prisma.configSnapshot.create({
        data: { nodeId, version, content: configJson, checksum, deployLog: logs.join('\n') },
      }),
      this.prisma.node.update({
        where: { id: nodeId },
        data: { status: success ? 'RUNNING' : 'ERROR' },
      }),
      this.operationLog.createLog({
        resourceType: 'node',
        resourceId: nodeId,
        resourceName: nodeName,
        actorId: actorId ?? null,
        operation: 'DEPLOY',
        correlationId: correlationId ?? null,
        success,
        log: logs.join('\n'),
        durationMs: Date.now() - startMs,
      }),
    ]);
  }
}

function buildSystemdUnit(name: string, bin: string, args: string): string {
  return [
    '[Unit]',
    `Description=NextPanel Node: ${name}`,
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${bin} ${args}`,
    'Restart=always',
    'RestartSec=3',
    'LimitNOFILE=65536',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n');
}
