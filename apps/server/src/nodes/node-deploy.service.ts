import * as crypto from 'crypto';
import { Injectable, Logger, MessageEvent, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NodeSSH } from 'node-ssh';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { CertService } from '../common/cert/cert.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
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
    private certService: CertService,
    private cfSettings: CloudflareSettingsService,
    private cfService: CloudflareService,
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
    const impl = (node.implementation ?? 'XRAY').toUpperCase();
    const isXray = impl === 'XRAY' || impl === 'V2RAY';
    const statsPort = isXray ? computeStatsPort(node.listenPort) : undefined;

    const nodeInfo: NodeInfo = {
      id: node.id,
      protocol: node.protocol,
      implementation: node.implementation,
      transport: node.transport,
      tls: node.tls,
      listenPort: node.listenPort,
      domain: node.domain,
      statsPort,
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

      // ── 5. Provision TLS certificate ───────────────────────────────────────
      if (node.tls === 'TLS') {
        const useLetsEncrypt =
          node.transport === 'TCP' &&
          node.source === 'AUTO' &&
          node.domain !== null;

        if (useLetsEncrypt) {
          const cf = await this.cfSettings.getDecryptedToken(node.userId);
          if (cf) {
            const baseDomain = node.domain!.split('.').slice(1).join('.');
            await this.certService.ensureWildcardCert(cf.apiToken, baseDomain, log);
            await this.certService.pushCertToNode(ssh, node.id, baseDomain, log);
          } else {
            log(`No CF settings found for user, falling back to self-signed cert`);
            await this.generateSelfSignedCert(ssh, node.id, node.domain ?? node.server.ip, log);
          }
        } else {
          await this.generateSelfSignedCert(ssh, node.id, node.domain ?? node.server.ip, log);
        }
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

      // Stop the service first to release the port cleanly before re-deploying.
      // Without this, the enable --now + restart sequence creates a race: systemd
      // starts xray (binds the port), then restart immediately stops it, then the
      // new xray finds the port still held by the brief first instance.
      await ssh.execCommand(`systemctl stop ${serviceName} 2>/dev/null || true`);

      // Kill any orphaned process for THIS node (e.g. stale from a failed previous
      // deploy that bypassed systemd). Target by config file path, not port, to
      // avoid killing other nodes running on the same server.
      await ssh.execCommand(`pkill -f "${configPath}" 2>/dev/null || true`);

      // Kill any orphaned proxy process occupying our ports (e.g. a deleted node
      // whose xray was not fully cleaned up). This handles cases where the DB no
      // longer has the record but the process is still holding the port.
      if (statsPort) await this.freePortIfOrphaned(ssh, statsPort, 'stats', log);
      await this.freePortIfOrphaned(ssh, node.listenPort, 'listen', log);

      log(`Starting service: ${serviceName}...`);
      // Use `enable` + `start` (not `enable --now` + `restart`) — the service is
      // already stopped above, so a single start is sufficient and avoids the
      // double-start race that caused "address already in use".
      const { stderr: startErr } = await ssh.execCommand(
        `systemctl enable ${serviceName} && systemctl start ${serviceName}`,
      );
      if (startErr) log(`Start warning: ${startErr}`);

      // ── 9. Open firewall port (best-effort) ───────────────────────────────
      for (const proto of this.getFirewallProtocols(node.protocol)) {
        await this.openFirewallPort(ssh, node.listenPort, proto, log);
      }

      // ── 10. Verify service is active ───────────────────────────────────────
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
      await this.finalize(nodeId, node.name, isActive, logs, configJson, actorId, startMs, correlationId, statsPort);

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
      await this.finalize(nodeId, node.name, false, logs, configJson, actorId, startMs, correlationId, statsPort);
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

      for (const proto of this.getFirewallProtocols(node.protocol)) {
        await this.closeFirewallPort(ssh, node.listenPort, proto, trackLog);
      }

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

    // ── Step 2: Cloudflare DNS cleanup (non-fatal) ────────────────────────────
    if (node.cfDnsRecordId && node.userId) {
      trackLog('正在清理 Cloudflare DNS 记录...');
      const cfSetting = await this.cfSettings.getDecryptedToken(node.userId);
      if (cfSetting) {
        try {
          await this.cfService.deleteRecord(cfSetting.apiToken, cfSetting.zoneId, node.cfDnsRecordId);
          trackLog('Cloudflare DNS 记录已清理');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          trackLog(`Cloudflare DNS 清理失败（已忽略）: ${msg}`);
          this.logger.error(`Cloudflare DNS cleanup failed for record ${node.cfDnsRecordId}: ${msg}`);
        }
      }
    }

    // ── Step 3: DB deletion — only after SSH cleanup confirmed ────────────────
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
      for (const proto of this.getFirewallProtocols(node.protocol)) {
        await this.closeFirewallPort(ssh, node.listenPort, proto);
      }
      ssh.dispose();
    } catch (err: unknown) {
      ssh?.dispose();
      // Re-throw so callers (NodesService.remove) know cleanup failed
      throw err;
    }
  }

  /** Start or stop the systemd service without touching config files */
  async toggleService(nodeId: string, enable: boolean): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);

    const sshAuth = this.crypto.decrypt(node.server.sshAuthEnc);
    const serviceName = `nextpanel-${node.id}`;
    const cmd = enable
      ? `systemctl start ${serviceName}`
      : `systemctl stop ${serviceName}`;

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
      await ssh.execCommand(cmd);
      ssh.dispose();
    } catch (err: unknown) {
      ssh?.dispose();
      throw err;
    }
  }

  // ── Cert refresh (called by CertRenewalScheduler) ─────────────────────────

  /**
   * Push a renewed LE cert to the node server and restart the service.
   * Used by the daily cert renewal scheduler.
   */
  async refreshCert(nodeId: string): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);
    if (!node.domain) return;

    const sshAuth = this.crypto.decrypt(node.server.sshAuthEnc);
    const serviceName = `nextpanel-${node.id}`;
    const baseDomain = node.domain.split('.').slice(1).join('.');

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
      await this.certService.pushCertToNode(ssh, node.id, baseDomain, (msg) =>
        this.logger.log(`[refreshCert ${nodeId}] ${msg}`),
      );
      await ssh.execCommand(`systemctl restart ${serviceName}`);
      ssh.dispose();
    } catch (err: unknown) {
      ssh?.dispose();
      throw err;
    }
  }

  // ── Cert helpers ──────────────────────────────────────────────────────────

  private async generateSelfSignedCert(
    ssh: NodeSSH,
    nodeId: string,
    cn: string,
    log: (msg: string) => void,
  ): Promise<void> {
    const certDir = '/etc/nextpanel/certs';
    const certFile = `${certDir}/${nodeId}.crt`;
    const keyFile = `${certDir}/${nodeId}.key`;
    log(`Ensuring self-signed TLS certificate at ${certFile}...`);
    // Determine SAN type: IP address or DNS name
    const isIp = /^[\d.]+$|^[0-9a-f:]+$/i.test(cn);
    const san = isIp ? `IP:${cn}` : `DNS:${cn}`;
    const { stderr: certErr } = await ssh.execCommand(
      `mkdir -p ${certDir} && openssl req -x509 -newkey rsa:2048 ` +
      `-keyout ${keyFile} -out ${certFile} -days 3650 -nodes -subj "/CN=${cn}" ` +
      `-addext "subjectAltName=${san}" 2>&1`,
    );
    if (certErr) log(`TLS cert warning: ${certErr}`);
    else log(`TLS certificate ready`);
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
    log(`Installing Xray...`);

    // Detect architecture
    const { stdout: uname } = await ssh.execCommand(`uname -m`);
    const archMap: Record<string, string> = { x86_64: '64', aarch64: 'arm64-v8a', armv7l: 'arm32-v7a' };
    const arch = archMap[uname.trim()] ?? '64';

    // Fetch latest release tag from GitHub
    const { stdout: apiOut } = await ssh.execCommand(
      `curl -sf "https://api.github.com/repos/XTLS/Xray-core/releases/latest"`,
    );
    const tagMatch = apiOut.match(/"tag_name"\s*:\s*"([^"]+)"/);
    if (!tagMatch) { log(`Failed to fetch Xray release info.`); return false; }
    const tag = tagMatch[1];
    log(`Latest Xray version: ${tag}, arch: ${arch}`);

    // Ensure unzip is available
    await ssh.execCommand(
      `command -v unzip >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq unzip) || (yum install -y unzip)`,
    );

    // Download zip and extract
    const zipName = `Xray-linux-${arch}.zip`;
    const { stderr } = await ssh.execCommand(
      `curl -fsSL -o /tmp/${zipName} "https://github.com/XTLS/Xray-core/releases/download/${tag}/${zipName}" && ` +
      `mkdir -p /tmp/xray_extract && ` +
      `unzip -o /tmp/${zipName} xray -d /tmp/xray_extract && ` +
      `mv /tmp/xray_extract/xray /usr/local/bin/xray && ` +
      `chmod +x /usr/local/bin/xray && ` +
      `rm -rf /tmp/${zipName} /tmp/xray_extract`,
    );
    if (stderr) log(stderr.trim());

    const { code } = await ssh.execCommand(`test -x /usr/local/bin/xray`);
    if (code === 0) { log(`Xray installed successfully.`); return true; }
    log(`Xray install failed.`);
    return false;
  }

  private async installV2Ray(ssh: NodeSSH, log: (msg: string) => void): Promise<boolean> {
    log(`Installing V2Ray via official script...`);
    // Ensure unzip is available — required by the V2Ray install script
    await ssh.execCommand(
      `DEBIAN_FRONTEND=noninteractive apt-get install -y unzip 2>/dev/null || yum install -y unzip 2>/dev/null; true`,
    );
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

  // ── Firewall helpers ─────────────────────────────────────────────────────

  /**
   * Returns the transport protocols that need firewall rules for a given proxy protocol.
   * - HYSTERIA2: UDP only (QUIC-based)
   * - SHADOWSOCKS: TCP + UDP (xray: network:'tcp,udp', ss-libev: mode:'tcp_and_udp')
   * - SOCKS5: TCP + UDP (xray: udp:true)
   * - All others (VLESS, VMESS, TROJAN, HTTP): TCP only
   */
  private getFirewallProtocols(protocol: string): ('tcp' | 'udp')[] {
    if (protocol === 'HYSTERIA2') return ['udp'];
    if (protocol === 'SHADOWSOCKS' || protocol === 'SOCKS5') return ['tcp', 'udp'];
    return ['tcp'];
  }

  /**
   * Open a firewall port via ufw (preferred) or iptables.
   * Best-effort: logs warnings but never throws.
   */
  private async openFirewallPort(
    ssh: NodeSSH,
    port: number,
    proto: 'tcp' | 'udp',
    log?: (msg: string) => void,
  ): Promise<void> {
    if (port < 1024) {
      log?.(`Skipping firewall for privileged port ${port}/${proto} (managed by sysadmin)`);
      return;
    }
    log?.(`Opening firewall port ${port}/${proto}...`);
    try {
      // If ufw is active, delegate entirely to ufw (mixing ufw + raw iptables breaks ufw chains).
      // Otherwise fall back to direct iptables + netfilter-persistent for persistence.
      await ssh.execCommand(
        `if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then ` +
        `  ufw allow ${port}/${proto} 2>/dev/null || true; ` +
        `else ` +
        `  iptables -C INPUT -p ${proto} --dport ${port} -j ACCEPT 2>/dev/null || ` +
        `  iptables -A INPUT -p ${proto} --dport ${port} -j ACCEPT 2>/dev/null || true; ` +
        `  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save 2>/dev/null || true; ` +
        `fi`,
      );
      log?.(`Firewall: port ${port}/${proto} opened`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.(`Firewall warning (non-fatal): ${msg}`);
    }
  }

  /**
   * Close a firewall port when a node is removed.
   * Best-effort: logs warnings but never throws.
   */
  private async closeFirewallPort(
    ssh: NodeSSH,
    port: number,
    proto: 'tcp' | 'udp',
    log?: (msg: string) => void,
  ): Promise<void> {
    if (port < 1024) {
      log?.(`Skipping firewall for privileged port ${port}/${proto} (managed by sysadmin)`);
      return;
    }
    log?.(`Closing firewall port ${port}/${proto}...`);
    try {
      await ssh.execCommand(
        `if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then ` +
        `  ufw delete allow ${port}/${proto} 2>/dev/null || true; ` +
        `else ` +
        `  iptables -D INPUT -p ${proto} --dport ${port} -j ACCEPT 2>/dev/null || true; ` +
        `  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save 2>/dev/null || true; ` +
        `fi`,
      );
      log?.(`Firewall: port ${port}/${proto} closed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.(`Firewall warning (non-fatal): ${msg}`);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * If `port` is already in use by an orphaned proxy binary (xray, sing-box, etc.),
   * kill it so the new deployment can bind the port cleanly.
   * Only proxy binaries are killed — arbitrary system processes are left alone.
   */
  private async freePortIfOrphaned(
    ssh: NodeSSH,
    port: number,
    label: string,
    log: (msg: string) => void,
  ): Promise<void> {
    const { stdout: pidRaw } = await ssh.execCommand(
      `fuser ${port}/tcp 2>/dev/null || true`,
    );
    const pid = pidRaw?.trim();
    if (!pid) return; // port is free

    const { stdout: commRaw } = await ssh.execCommand(
      `cat /proc/${pid}/comm 2>/dev/null || true`,
    );
    const comm = commRaw?.trim();
    const PROXY_BINS = new Set(['xray', 'sing-box', 'hysteria', 'hysteria2', 'v2ray']);
    if (PROXY_BINS.has(comm ?? '')) {
      log(`${label} port ${port} occupied by orphaned ${comm} (PID ${pid}), killing...`);
      await ssh.execCommand(`kill -9 ${pid} 2>/dev/null || true`);
      await new Promise((r) => setTimeout(r, 300));
      log(`Orphaned process killed, ${label} port ${port} freed`);
    } else if (comm) {
      log(`WARNING: ${label} port ${port} in use by "${comm}" (PID ${pid}) — not a proxy binary, skipping`);
    }
  }

  private async finalize(
    nodeId: string,
    nodeName: string,
    success: boolean,
    logs: string[],
    configJson: string,
    actorId: string | undefined,
    startMs: number,
    correlationId?: string,
    statsPort?: number,
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

    // P2003 = FK constraint (node deleted), P2025 = record not found — both mean node is gone
    const ignoreDeletedNode = (e: unknown) => {
      const code = (e as { code?: string })?.code;
      if (code === 'P2003' || code === 'P2025') return;
      throw e;
    };

    await Promise.all([
      this.prisma.configSnapshot.create({
        data: { nodeId, version, content: configJson, checksum, deployLog: logs.join('\n') },
      }).catch(ignoreDeletedNode),
      this.prisma.node.update({
        where: { id: nodeId },
        data: {
          status: success ? 'RUNNING' : 'ERROR',
          // Reset traffic counters and assign statsPort on each (re)deploy
          statsPort: success ? (statsPort ?? null) : undefined,
          trafficUpBytes: success ? 0 : undefined,
          trafficDownBytes: success ? 0 : undefined,
        },
      }).catch(ignoreDeletedNode),
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

/**
 * Derives a local stats API port from the node's main listen port.
 * Uses a +20000 offset (capped to valid range) to avoid conflicts.
 */
function computeStatsPort(listenPort: number): number {
  if (listenPort + 20000 <= 65535) return listenPort + 20000;
  if (listenPort - 20000 >= 1) return listenPort - 20000;
  return 40000 + (listenPort % 10000);
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
    'LimitNOFILE=1048576',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
  ].join('\n');
}
