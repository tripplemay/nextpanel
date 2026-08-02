import * as crypto from 'crypto';
import { Injectable, Logger, MessageEvent, NotFoundException, BadRequestException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NodeSSH } from 'node-ssh';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { CertService, type RemoteCertUpdate } from '../common/cert/cert.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
import { withPostgresAdvisoryLocks } from '../common/database/advisory-lock';
import { generateConfig, generateChainExitConfig, getBinaryCommand, NodeInfo } from './config/config-generator';
import { connectSsh, uploadText, binaryExists, whichBinary, detectPackageManager } from './ssh/ssh.util';
import { parseStoredSocksExit } from './socks-uri';
import { XrayTestService } from './xray-test/xray-test.service';

export interface DeployResult {
  success: boolean;
  log: string;
  /** The replacement failed and the prior remote deployment could not be verified as restored. */
  rollbackFailed?: boolean;
}

export interface DeployOptions {
  /** Protect an existing deployment even when the target shape is legacy. */
  forceRollback?: boolean;
  /** Caller already holds the cross-process node operation lock. */
  skipAdvisoryLock?: boolean;
  /** Firewall shape that may be retired only after the replacement is healthy. */
  previousFirewall?: { port: number; protocol: string };
}

interface RemoteOperationOptions {
  /** Caller already holds the cross-process node operation lock. */
  skipAdvisoryLock?: boolean;
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
    private xrayTest: XrayTestService,
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

  async deploy(
    nodeId: string,
    onLog?: (line: string) => void,
    actorId?: string,
    correlationId?: string,
    options: DeployOptions = {},
  ): Promise<DeployResult> {
    const lockTarget = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { serverId: true, exitServerId: true },
    });
    if (!lockTarget) throw new NotFoundException(`Node ${nodeId} not found`);

    const lockKeys = [
      `nextpanel:server-core:${lockTarget.serverId}`,
      ...(lockTarget.exitServerId
        ? [`nextpanel:server-core:${lockTarget.exitServerId}`]
        : []),
      ...(!options.skipAdvisoryLock ? [`nextpanel:node:${nodeId}`] : []),
    ];
    return this.withDatabaseLocks(lockKeys, () =>
      this.deployExclusive(nodeId, onLog, actorId, correlationId, {
        ...options,
        skipAdvisoryLock: true,
      }),
    );
  }

  private async deployExclusive(
    nodeId: string,
    onLog?: (line: string) => void,
    actorId?: string,
    correlationId?: string,
    options: DeployOptions = {},
  ): Promise<DeployResult> {
    const startMs = Date.now();
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);
    if (node.server.status === 'DELETING') {
      throw new BadRequestException('服务器正在删除，不能部署节点');
    }

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
      egressIpPolicy: node.egressIpPolicy,
      statsPort,
    };

    // If chain node, add chain info to NodeInfo
    if (node.exitServerId && node.exitPort && node.chainCredEnc) {
      const exitServer = await this.prisma.server.findUnique({ where: { id: node.exitServerId } });
      if (!exitServer) throw new Error('出口服务器不存在');
      if (exitServer.status === 'DELETING') {
        throw new BadRequestException('出口服务器正在删除，不能部署链式节点');
      }
      const chain = parseChainCredentials(this.crypto.decrypt(node.chainCredEnc));
      nodeInfo.chainExitIp = exitServer.ip;
      nodeInfo.chainExitPort = node.exitPort;
      nodeInfo.chainUuid = chain.uuid;
      nodeInfo.chainRealityPrivateKey = chain.realityPrivateKey;
      nodeInfo.chainRealityPublicKey = chain.realityPublicKey;
      nodeInfo.chainShortId = chain.shortId;
    }
    if (node.exitType === 'SOCKS5') {
      if (!node.socksExitEnc || node.exitServerId || node.exitPort || node.chainCredEnc) {
        throw new Error('SOCKS5 链式出口配置不完整');
      }
      nodeInfo.socksExit = parseStoredSocksExit(this.crypto.decrypt(node.socksExitEnc));
    }

    let configJson: string;
    try {
      configJson = generateConfig(nodeInfo, credentials);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Configuration generation failed: ${message}`);
      await this.finalize(
        nodeId,
        node.name,
        false,
        logs,
        '',
        actorId,
        startMs,
        correlationId,
        statsPort,
      );
      return { success: false, log: logs.join('\n') };
    }
    const configPath = `/etc/nextpanel/nodes/${node.id}.json`;
    const serviceName = `nextpanel-${node.id}`;
    const { bin: defaultBin, args } = getBinaryCommand(nodeInfo);
    let bin = defaultBin;

    log(`Starting deployment for node: ${node.name}`);
    log(`Server: ${node.server.ip}:${node.server.sshPort}`);

    // ── 3. SSH connect ───────────────────────────────────────────────────────
    const server = node.server;
    if (!server.sshAuthEnc) {
      throw new BadRequestException('SSH 凭证已销毁，请先在服务器详情页恢复凭证');
    }
    const sshAuth = this.crypto.decrypt(server.sshAuthEnc);
    let ssh: NodeSSH | null = null;
    let stagedConfigPath: string | null = null;
    let deploymentRollback: DeploymentRollback | null = null;
    let chainExitDeployment: ChainExitDeployment | null = null;
    let certUpdate: RemoteCertUpdate | null = null;
    let firewallChanges: FirewallChange[] = [];
    let rollbackFailed = false;

    try {
      log(`Connecting via SSH...`);
      ssh = await connectSsh({
        host: server.ip,
        port: server.sshPort,
        username: server.sshUser,
        authType: server.sshAuthType as 'KEY' | 'PASSWORD',
        auth: sshAuth,
        readyTimeout: 30000,
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

      const coreRequirement = getCoreVersionRequirement(node.protocol, node.transport);
      if (coreRequirement) {
        if (impl !== coreRequirement.implementation) {
          throw new Error(
            `${node.protocol}${node.transport === 'XHTTP' ? '+XHTTP' : ''} requires ` +
            `${coreRequirement.implementation}, got ${impl}`,
          );
        }
        bin = await this.ensureCoreVersion(
          ssh,
          bin,
          impl,
          coreRequirement.minimumVersion,
          log,
        );
      }

      // ── 5. Provision TLS certificate ───────────────────────────────────────
      const strictManagedTls = node.protocol === 'TUIC' || node.protocol === 'ANYTLS';
      const hasDomain = !!node.domain?.trim();
      if (strictManagedTls && !hasDomain) {
        throw new Error(`${node.protocol} requires a managed domain and trusted TLS certificate`);
      }

      if (node.tls === 'TLS' || strictManagedTls) {
        const useLetsEncrypt =
          hasDomain &&
          (strictManagedTls || (node.transport === 'TCP' && node.source === 'AUTO'));

        if (useLetsEncrypt) {
          const cf = await this.cfSettings.getDecryptedToken(node.userId);
          if (cf) {
            const baseDomain = node.domain!.split('.').slice(1).join('.');
            await this.certService.ensureWildcardCert(cf.apiToken, baseDomain, log);
            certUpdate = await this.certService.pushCertToNode(
              ssh,
              node.id,
              baseDomain,
              log,
            );
          } else {
            if (strictManagedTls) {
              throw new Error(`${node.protocol} requires valid Cloudflare settings for certificate issuance`);
            }
            log(`No CF settings found for user, falling back to self-signed cert`);
            await this.generateSelfSignedCert(ssh, node.id, node.domain ?? node.server.ip, log);
          }
        } else {
          await this.generateSelfSignedCert(ssh, node.id, node.domain ?? node.server.ip, log);
        }
      }

      // Validate modern protocol and managed chain configs before exit changes.
      // Activation is deferred until the exit service is confirmed active.
      const isChainNode = !!(
        (node.exitServerId && node.exitPort && node.chainCredEnc)
        || (node.exitType === 'SOCKS5' && node.socksExitEnc)
      );
      const supportsConfigValidation = impl === 'XRAY' || impl === 'SING_BOX';
      if (coreRequirement || (isChainNode && supportsConfigValidation)) {
        stagedConfigPath = await this.stageAndValidateConfig(
          ssh,
          bin,
          impl,
          configJson,
          configPath,
          log,
        );
      }

      // ── 5b. Chain: deploy exit server after entry validation ────────────────
      if (node.exitServerId && node.exitPort && node.chainCredEnc) {
        const exitServer = await this.prisma.server.findUnique({ where: { id: node.exitServerId } });
        if (!exitServer) throw new Error('出口服务器不存在');
        if (!exitServer.sshAuthEnc) throw new Error('出口服务器凭证已销毁');
        chainExitDeployment = await this.deployChainExit(
          {
            id: node.id,
            exitPort: node.exitPort,
            chainCredEnc: node.chainCredEnc,
            egressIpPolicy: node.egressIpPolicy,
          },
          { ip: node.server.ip },
          exitServer,
          log,
        );
      }

      const unitContent = buildSystemdUnit(node.name, bin, args);
      const unitPath = `/etc/systemd/system/${serviceName}.service`;
      if (coreRequirement || isChainNode || options.forceRollback || node.listenPort === 443) {
        deploymentRollback = await this.prepareDeploymentRollback(
          ssh,
          configPath,
          unitPath,
          serviceName,
          log,
        );
      }

      // ── 6. Upload config file (base64 to avoid shell escaping issues) ──────
      if (stagedConfigPath) {
        await this.activateStagedConfig(ssh, stagedConfigPath, configPath, log);
        stagedConfigPath = null;
      } else {
        log(`Uploading config to ${configPath}...`);
        await uploadText(ssh, configJson, configPath);
        log(`Config uploaded to ${configPath}`);
      }

      // ── 7. Write systemd unit ──────────────────────────────────────────────
      log(`Writing systemd unit to ${unitPath}...`);
      await uploadText(ssh, unitContent, unitPath, 0o644);
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
      await this.freePortIfOrphaned(
        ssh,
        node.listenPort,
        'listen',
        log,
        this.getPrimarySocketProtocol(node.protocol),
      );

      log(`Starting service: ${serviceName}...`);
      // Use `enable` + `start` (not `enable --now` + `restart`) — the service is
      // already stopped above, so a single start is sufficient and avoids the
      // double-start race that caused "address already in use".
      const { stderr: startErr } = await ssh.execCommand(
        `systemctl enable ${serviceName} && systemctl start ${serviceName}`,
      );
      if (startErr) log(`Start warning: ${startErr}`);

      // Verify service actually started
      await new Promise((r) => setTimeout(r, 2000));
      const { stdout: activeStatus } = await ssh.execCommand(`systemctl is-active ${serviceName}`);
      log(`Service post-start status: ${activeStatus.trim()}`);

      // ── 9. Open firewall port (best-effort) ───────────────────────────────
      for (const proto of this.getFirewallProtocols(node.protocol)) {
        firewallChanges.push(await this.openFirewallPort(
          ssh,
          node.listenPort,
          proto,
          log,
          deploymentRollback !== null,
          node.server.ip,
        ));
      }

      // ── 10. Verify service is active ───────────────────────────────────────
      log(`Waiting for service to stabilize...`);
      await new Promise((r) => setTimeout(r, 2000));
      const { stdout: activeOut } = await ssh.execCommand(
        `systemctl is-active ${serviceName}`,
      );
      let isActive = activeOut.trim() === 'active';
      log(`Service status: ${activeOut.trim()}`);

      if (isActive && node.exitType === 'SOCKS5') {
        log('正在验证 SOCKS5 出口的 TCP 与 UDP 端到端连通性...');
        const connectivity = await this.xrayTest.testNode(node.id);
        isActive = connectivity.reachable;
        log(connectivity.message);
      }

      if (!isActive) {
        const { stdout: journalOut } = await ssh.execCommand(
          `journalctl -u ${serviceName} -n 30 --no-pager 2>&1 || true`,
        );
        if (journalOut?.trim()) log(`Service logs:\n${journalOut.trim()}`);
        const firewallRestored = await this.rollbackFirewallChanges(firewallChanges, log);
        rollbackFailed ||= !firewallRestored;
        firewallChanges = [];
        if (certUpdate?.changed) {
          const restored = await certUpdate.rollback();
          rollbackFailed ||= !restored;
          certUpdate = null;
        }
        if (deploymentRollback) {
          const restored = await this.restoreDeploymentRollback(ssh, deploymentRollback, log);
          rollbackFailed ||= !restored;
          deploymentRollback = null;
        }
        if (chainExitDeployment) {
          const restored = await this.rollbackChainExitDeployment(chainExitDeployment, log);
          rollbackFailed ||= !restored;
          chainExitDeployment = null;
        }
      }

      await this.finalize(nodeId, node.name, isActive, logs, configJson, actorId, startMs, correlationId, statsPort);

      // Keep both rollback points until the database status/snapshot commit has
      // succeeded. A persistence failure must not leave the remote pair committed
      // while callers compensate the node row back to its previous shape.
      if (isActive) {
        if (chainExitDeployment) {
          await this.commitChainExitDeployment(chainExitDeployment, log);
          chainExitDeployment = null;
        }
        if (deploymentRollback) {
          await this.cleanupDeploymentRollback(ssh, deploymentRollback, log);
          deploymentRollback = null;
        }
        if (certUpdate) {
          await certUpdate.commit();
          certUpdate = null;
        }
        if (options.previousFirewall) {
          const previousProtocols = this.getFirewallProtocols(
            options.previousFirewall.protocol,
          );
          const currentProtocols = this.getFirewallProtocols(node.protocol);
          for (const proto of previousProtocols) {
            const stillRequired =
              options.previousFirewall.port === node.listenPort &&
              currentProtocols.includes(proto);
            if (!stillRequired) {
              await this.closeFirewallPort(
                ssh,
                options.previousFirewall.port,
                proto,
                log,
                node.server.ip,
              );
            }
          }
        }
        firewallChanges = [];
      }

      ssh.dispose();

      if (isActive) {
        log(`Deployment completed successfully!`);
      } else {
        log(`Deployment finished but service is not active. Check server logs.`);
      }

      return {
        success: isActive,
        log: logs.join('\n'),
        ...(rollbackFailed ? { rollbackFailed: true } : {}),
      };
    } catch (err: unknown) {
      rollbackFailed ||= isDeploymentRollbackFailure(err);
      if (ssh && stagedConfigPath) {
        await this.cleanupStagedConfig(ssh, stagedConfigPath, log);
      }
      const firewallRestored = await this.rollbackFirewallChanges(firewallChanges, log);
      rollbackFailed ||= !firewallRestored;
      firewallChanges = [];
      if (ssh && certUpdate?.changed) {
        const restored = await certUpdate.rollback();
        rollbackFailed ||= !restored;
        certUpdate = null;
      }
      if (ssh && deploymentRollback) {
        const restored = await this.restoreDeploymentRollback(ssh, deploymentRollback, log);
        rollbackFailed ||= !restored;
        deploymentRollback = null;
      }
      if (chainExitDeployment) {
        const restored = await this.rollbackChainExitDeployment(chainExitDeployment, log);
        rollbackFailed ||= !restored;
        chainExitDeployment = null;
      }
      ssh?.dispose();
      const msg = err instanceof Error ? err.message : String(err);
      log(`Deploy error: ${msg}`);
      try {
        await this.finalize(nodeId, node.name, false, logs, configJson, actorId, startMs, correlationId, statsPort);
      } catch (finalizeErr) {
        if (rollbackFailed) {
          const finalizeMessage = finalizeErr instanceof Error
            ? finalizeErr.message
            : String(finalizeErr);
          throw new DeploymentRollbackFailureError(
            `${msg}; deployment failure could not be persisted: ${finalizeMessage}`,
          );
        }
        throw finalizeErr;
      }
      return {
        success: false,
        log: logs.join('\n'),
        ...(rollbackFailed ? { rollbackFailed: true } : {}),
      };
    }
  }

  private async withDatabaseLocks<T>(keys: string[], work: () => Promise<T>): Promise<T> {
    return withPostgresAdvisoryLocks(keys, work);
  }

  private async remoteOperationLockKeys(
    nodeId: string,
    skipAdvisoryLock = false,
  ): Promise<string[] | null> {
    const target = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { serverId: true, exitServerId: true },
    });
    if (!target) return null;
    return [
      `nextpanel:server-core:${target.serverId}`,
      ...(target.exitServerId ? [`nextpanel:server-core:${target.exitServerId}`] : []),
      ...(!skipAdvisoryLock ? [`nextpanel:node:${nodeId}`] : []),
    ];
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
    const lockKeys = await this.remoteOperationLockKeys(nodeId);
    if (!lockKeys) throw new NotFoundException(`节点 ${nodeId} 不存在`);
    return this.withDatabaseLocks(lockKeys, () =>
      this.doUndeployWithLogsExclusive(nodeId, onLog, actorId, correlationId),
    );
  }

  private async doUndeployWithLogsExclusive(
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

    if (!node.server.sshAuthEnc) {
      throw new BadRequestException('SSH 凭证已销毁，请先在服务器详情页恢复凭证');
    }
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
        readyTimeout: 30000,
      });
      trackLog('SSH 已连接');

      trackLog(`正在清理服务 ${serviceName}...`);
      await this.cleanupMainNodeRemote(ssh, node.id, trackLog);

      for (const proto of this.getFirewallProtocols(node.protocol)) {
        await this.closeFirewallPort(
          ssh,
          node.listenPort,
          proto,
          trackLog,
          node.server.ip,
          true,
        );
      }
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

    // ── Step 1b: Clean up chain exit service if this is a chain node ─────────
    if (node.exitServerId && node.exitPort) {
      try {
        const exitServer = await this.prisma.server.findUnique({ where: { id: node.exitServerId } });
        if (!exitServer?.sshAuthEnc) throw new Error('出口服务器不存在或 SSH 凭证已销毁');
        const exitSsh = new NodeSSH();
        try {
          const exitAuth = this.crypto.decrypt(exitServer.sshAuthEnc);
          await exitSsh.connect({
            host: exitServer.ip,
            port: exitServer.sshPort,
            username: exitServer.sshUser,
            ...(exitServer.sshAuthType === 'KEY' ? { privateKey: exitAuth } : { password: exitAuth }),
            readyTimeout: 30000,
          });
          await this.cleanupChainExitRemote(
            exitSsh,
            node.id,
            node.server.ip,
            node.exitPort,
            trackLog,
          );
        } finally {
          exitSsh.dispose();
        }
        trackLog('[出口] 链式出口已清理');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        trackLog(`[出口] 链式出口清理失败，节点记录已保留: ${message}`);
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
        throw new Error(`出口服务器清理失败: ${message}`);
      }
    }

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
  async undeploy(nodeId: string, options: RemoteOperationOptions = {}): Promise<void> {
    const lockKeys = await this.remoteOperationLockKeys(nodeId, options.skipAdvisoryLock);
    if (!lockKeys) return;
    return this.withDatabaseLocks(lockKeys, () => this.undeployExclusive(nodeId));
  }

  private async undeployExclusive(nodeId: string): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) return;

    if (!node.server.sshAuthEnc) {
      throw new BadRequestException('SSH 凭证已销毁，请先在服务器详情页恢复凭证');
    }
    const sshAuth = this.crypto.decrypt(node.server.sshAuthEnc);
    let ssh: NodeSSH | null = null;
    try {
      ssh = await connectSsh({
        host: node.server.ip,
        port: node.server.sshPort,
        username: node.server.sshUser,
        authType: node.server.sshAuthType as 'KEY' | 'PASSWORD',
        auth: sshAuth,
        readyTimeout: 30000,
      });
      await this.cleanupMainNodeRemote(ssh, node.id);
      for (const proto of this.getFirewallProtocols(node.protocol)) {
        await this.closeFirewallPort(
          ssh,
          node.listenPort,
          proto,
          undefined,
          node.server.ip,
          true,
        );
      }
      ssh.dispose();

      // Clean up chain exit service if this is a chain node
      if (node.exitServerId && node.exitPort) {
        const exitServer = await this.prisma.server.findUnique({ where: { id: node.exitServerId } });
        if (!exitServer?.sshAuthEnc) throw new Error('出口服务器不存在或 SSH 凭证已销毁');
        const exitSsh = new NodeSSH();
        try {
          const exitAuth = this.crypto.decrypt(exitServer.sshAuthEnc);
          await exitSsh.connect({
            host: exitServer.ip,
            port: exitServer.sshPort,
            username: exitServer.sshUser,
            ...(exitServer.sshAuthType === 'KEY' ? { privateKey: exitAuth } : { password: exitAuth }),
            readyTimeout: 30000,
          });
          await this.cleanupChainExitRemote(
            exitSsh,
            node.id,
            node.server.ip,
            node.exitPort,
          );
        } finally {
          exitSsh.dispose();
        }
      }
    } catch (err: unknown) {
      ssh?.dispose();
      // Re-throw so callers (NodesService.remove) know cleanup failed
      throw err;
    }
  }

  /** Start or stop the systemd service without touching config files */
  async toggleService(
    nodeId: string,
    enable: boolean,
    options: RemoteOperationOptions = {},
  ): Promise<void> {
    const lockKeys = await this.remoteOperationLockKeys(nodeId, options.skipAdvisoryLock);
    if (!lockKeys) throw new NotFoundException(`Node ${nodeId} not found`);
    return this.withDatabaseLocks(lockKeys, () => this.toggleServiceExclusive(nodeId, enable));
  }

  private async toggleServiceExclusive(nodeId: string, enable: boolean): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);

    if (!node.server.sshAuthEnc) {
      throw new BadRequestException('SSH 凭证已销毁，请先在服务器详情页恢复凭证');
    }
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
        readyTimeout: 30000,
      });
      const result = await ssh.execCommand(cmd);
      if ((result.code ?? 0) !== 0) {
        throw new Error(
          `Failed to ${enable ? 'start' : 'stop'} ${serviceName}` +
          `${commandDetail(result.stdout, result.stderr) ?
            `: ${commandDetail(result.stdout, result.stderr)}` : ''}`,
        );
      }
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
    const lockKeys = await this.remoteOperationLockKeys(nodeId);
    if (!lockKeys) throw new NotFoundException(`Node ${nodeId} not found`);
    return this.withDatabaseLocks(lockKeys, () => this.refreshCertExclusive(nodeId));
  }

  private async refreshCertExclusive(nodeId: string): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      include: { server: true },
    });
    if (!node) throw new NotFoundException(`Node ${nodeId} not found`);
    if (!node.domain) return;

    if (!node.server.sshAuthEnc) {
      throw new BadRequestException('SSH 凭证已销毁，请先在服务器详情页恢复凭证');
    }
    const sshAuth = this.crypto.decrypt(node.server.sshAuthEnc);
    const serviceName = `nextpanel-${node.id}`;
    const baseDomain = node.domain.split('.').slice(1).join('.');

    let ssh: NodeSSH | null = null;
    let certUpdate: RemoteCertUpdate | null = null;
    try {
      ssh = await connectSsh({
        host: node.server.ip,
        port: node.server.sshPort,
        username: node.server.sshUser,
        authType: node.server.sshAuthType as 'KEY' | 'PASSWORD',
        auth: sshAuth,
        readyTimeout: 30000,
      });
      certUpdate = await this.certService.pushCertToNode(ssh, node.id, baseDomain, (msg) =>
        this.logger.log(`[refreshCert ${nodeId}] ${msg}`),
      );
      if (!certUpdate.changed) return;
      if (node.enabled === false) {
        await certUpdate.commit();
        certUpdate = null;
        return;
      }

      const restart = await ssh.execCommand(`systemctl restart ${serviceName}`);
      if (restart.code !== 0) {
        throw new Error(
          `Failed to restart ${serviceName} after certificate update` +
          `${commandDetail(restart.stdout, restart.stderr) ?
            `: ${commandDetail(restart.stdout, restart.stderr)}` : ''}`,
        );
      }
      const health = await ssh.execCommand(
        `systemctl is-active --quiet ${shellQuote(serviceName)}`,
      );
      if (health.code !== 0) {
        throw new Error(`${serviceName} is not active after certificate update`);
      }
      await certUpdate.commit();
      certUpdate = null;
    } catch (err: unknown) {
      if (isDeploymentRollbackFailure(err)) {
        await this.prisma.node.update({
          where: { id: nodeId },
          data: { status: 'ERROR' },
        }).catch(() => undefined);
      }
      if (ssh && certUpdate?.changed) {
        const restored = await certUpdate.rollback();
        certUpdate = null;
        if (!restored) {
          const message = err instanceof Error ? err.message : String(err);
          await this.prisma.node.update({
            where: { id: nodeId },
            data: { status: 'ERROR' },
          }).catch(() => undefined);
          throw new DeploymentRollbackFailureError(
            `${message}; previous TLS certificate could not be restored`,
          );
        }

        const restartOld = await ssh.execCommand(`systemctl restart ${shellQuote(serviceName)}`);
        const healthOld = restartOld.code === 0
          ? await ssh.execCommand(`systemctl is-active --quiet ${shellQuote(serviceName)}`)
          : null;
        if (restartOld.code !== 0 || healthOld?.code !== 0) {
          const message = err instanceof Error ? err.message : String(err);
          await this.prisma.node.update({
            where: { id: nodeId },
            data: { status: 'ERROR' },
          }).catch(() => undefined);
          throw new DeploymentRollbackFailureError(
            `${message}; previous certificate was restored but ${serviceName} could not be recovered`,
          );
        }
      }
      throw err;
    } finally {
      ssh?.dispose();
    }
  }

  // ── Chain exit deployment ─────────────────────────────────────────────────

  private async deployChainExit(
    node: { id: string; exitPort: number; chainCredEnc: string; egressIpPolicy: string },
    entryServer: { ip: string },
    exitServer: { id: string; ip: string; sshPort: number; sshUser: string; sshAuthType: string; sshAuthEnc: string },
    log: (msg: string) => void,
  ): Promise<ChainExitDeployment> {
    const exitSsh = new NodeSSH();
    const sshAuth = this.crypto.decrypt(exitServer.sshAuthEnc);
    let stagedExitConfig: string | null = null;
    let rollback: DeploymentRollback | null = null;
    let handedOff = false;

    try {
      log(`[出口] 连接 ${exitServer.ip}:${exitServer.sshPort}...`);
      await exitSsh.connect({
        host: exitServer.ip,
        port: exitServer.sshPort,
        username: exitServer.sshUser,
        ...(exitServer.sshAuthType === 'KEY' ? { privateKey: sshAuth } : { password: sshAuth }),
        readyTimeout: 30000,
      });

      log(`[出口] 检查 Xray...`);
      const { code } = await exitSsh.execCommand('test -x /usr/local/bin/xray');
      if (code !== 0) {
        log(`[出口] 安装 Xray...`);
        const installed = await this.installXray(exitSsh, (m) => log(`[出口] ${m}`));
        if (!installed) throw new Error('出口服务器 Xray 安装失败');
      }
      const exitBin = await this.ensureCoreVersion(
        exitSsh,
        '/usr/local/bin/xray',
        'XRAY',
        '25.3.6',
        (message) => log(`[出口] ${message}`),
      );

      const chain = parseChainCredentials(this.crypto.decrypt(node.chainCredEnc));
      const exitConfig = generateChainExitConfig(
        node.id,
        node.exitPort,
        chain.uuid,
        entryServer.ip,
        chain.realityPrivateKey && chain.shortId
          ? { privateKey: chain.realityPrivateKey, shortId: chain.shortId }
          : undefined,
        node.egressIpPolicy,
      );
      const exitConfigPath = `/etc/nextpanel/nodes/chain-${node.id}.json`;
      const exitServiceName = `nextpanel-chain-${node.id}`;
      const exitUnitPath = `/etc/systemd/system/${exitServiceName}.service`;
      const unit = [
        '[Unit]',
        `Description=NextPanel Chain Exit: ${node.id}`,
        'After=network.target',
        '',
        '[Service]',
        'Type=simple',
        `ExecStart=${exitBin} run -config ${exitConfigPath}`,
        'Restart=always',
        'RestartSec=3',
        'LimitNOFILE=1048576',
        '',
        '[Install]',
        'WantedBy=multi-user.target',
      ].join('\n');

      log(`[出口] 校验并安装配置到 ${exitConfigPath}...`);
      await exitSsh.execCommand(`mkdir -p /etc/nextpanel/nodes`);
      stagedExitConfig = await this.stageAndValidateConfig(
        exitSsh,
        exitBin,
        'XRAY',
        exitConfig,
        exitConfigPath,
        (message) => log(`[出口] ${message}`),
      );
      rollback = await this.prepareDeploymentRollback(
        exitSsh,
        exitConfigPath,
        exitUnitPath,
        exitServiceName,
        (message) => log(`[出口] ${message}`),
      );
      await this.activateStagedConfig(
        exitSsh,
        stagedExitConfig,
        exitConfigPath,
        (message) => log(`[出口] ${message}`),
      );
      stagedExitConfig = null;
      await uploadText(exitSsh, unit, exitUnitPath, 0o644);

      // Stop our prior instance after capturing its rollback state. Otherwise
      // its PID would look like a conflicting managed service during redeploy.
      const stopCurrent = await exitSsh.execCommand(
        `systemctl stop ${shellQuote(exitServiceName)} 2>/dev/null || true; ` +
        `! systemctl is-active --quiet ${shellQuote(exitServiceName)}`,
      );
      if ((stopCurrent.code ?? 0) !== 0) {
        throw new Error(`现有链式出口服务 ${exitServiceName} 仍处于活动状态`);
      }

      // Kill any orphaned process occupying the exit port before starting.
      log(`[出口] 检查端口 ${node.exitPort} 是否被占用...`);
      const { stdout: fuserOut } = await exitSsh.execCommand(
        `fuser ${node.exitPort}/tcp 2>/dev/null || true`,
      );
      const occupyingPids = fuserOut.trim().split(/\s+/).filter(Boolean);
      if (occupyingPids.length > 0) {
        const { stdout: unitList } = await exitSsh.execCommand(
          `systemctl list-units 'nextpanel-*' --plain --no-legend --all | awk '{print $1}'`,
        );
        for (const occupiedUnit of unitList.trim().split('\n').filter(Boolean)) {
          if (occupiedUnit === `${exitServiceName}.service`) continue;
          const { stdout: mainPid } = await exitSsh.execCommand(
            `systemctl show ${occupiedUnit} -p MainPID --value 2>/dev/null || true`,
          );
          if (occupyingPids.includes(mainPid.trim())) {
            throw new Error(
              `出口端口 ${node.exitPort} 已被受管服务 ${occupiedUnit} ` +
              `(PID ${mainPid.trim()}) 占用，拒绝覆盖`,
            );
          }
        }
        for (const pid of occupyingPids) {
          const { stdout: comm } = await exitSsh.execCommand(
            `cat /proc/${pid}/comm 2>/dev/null || true`,
          );
          if (comm.trim() !== 'xray') {
            throw new Error(
              `出口端口 ${node.exitPort} 已被 ${comm.trim() || '未知进程'} ` +
              `(PID ${pid}) 占用，拒绝终止`,
            );
          }
          const { stdout: ownerUnit } = await exitSsh.execCommand(
            `sed -n 's#.*\\(/nextpanel-[^/]*\\.service\\).*#\\1#p' ` +
            `/proc/${pid}/cgroup 2>/dev/null | sed 's#^/##' | head -n 1`,
          );
          if (ownerUnit.trim()) {
            throw new Error(
              `出口端口 ${node.exitPort} 已被受管服务 ${ownerUnit.trim()} ` +
              `(PID ${pid}) 占用，拒绝覆盖`,
            );
          }
          log(`[出口] 终止占用端口的孤儿进程 (PID ${pid})...`);
          const killed = await exitSsh.execCommand(`kill -9 ${pid} 2>/dev/null`);
          if (killed.code !== 0) {
            throw new Error(`无法释放出口端口 ${node.exitPort} (PID ${pid})`);
          }
        }
      }

      await exitSsh.execCommand('systemctl daemon-reload');
      await exitSsh.execCommand(
        `systemctl enable ${exitServiceName} && systemctl start ${exitServiceName}`,
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));
      const { stdout: status } = await exitSsh.execCommand(
        `systemctl is-active ${exitServiceName}`,
      );
      if (status.trim() !== 'active') {
        const { stdout: journal } = await exitSsh.execCommand(
          `journalctl -u ${exitServiceName} -n 20 --no-pager`,
        );
        log(`[出口] 服务启动失败: ${journal}`);
        throw new Error('出口服务器链式服务启动失败');
      }

      handedOff = true;
      log(`[出口] 服务已就绪，等待入口服务确认后提交`);
      return {
        ssh: exitSsh,
        rollback,
        entryIp: entryServer.ip,
        exitPort: node.exitPort,
      };
    } catch (err) {
      if (stagedExitConfig) {
        await this.cleanupStagedConfig(
          exitSsh,
          stagedExitConfig,
          (message) => log(`[出口] ${message}`),
        );
      }
      if (rollback) {
        const restored = await this.restoreDeploymentRollback(
          exitSsh,
          rollback,
          (message) => log(`[出口] ${message}`),
        );
        if (!restored) {
          const message = err instanceof Error ? err.message : String(err);
          throw new DeploymentRollbackFailureError(
            `${message}; 出口服务器旧配置恢复失败`,
          );
        }
      }
      throw err;
    } finally {
      if (!handedOff) exitSsh.dispose();
    }
  }

  private async commitChainExitDeployment(
    deployment: ChainExitDeployment,
    log: (msg: string) => void,
  ): Promise<void> {
    const { ssh, rollback, entryIp, exitPort } = deployment;
    const addressFamily = entryIp.includes(':') ? 'ipv6' : 'ipv4';
    const iptables = addressFamily === 'ipv6' ? 'ip6tables' : 'iptables';
    const ruleComment = 'nextpanel-chain-managed';
    const richRule =
      `rule family="${addressFamily}" priority="-27182" source address="${entryIp}" ` +
      `port protocol="tcp" port="${exitPort}" accept`;
    const addedMarker = '__NEXTPANEL_CHAIN_FIREWALL_ADDED__';
    log(`[出口] 配置防火墙（仅允许 ${entryIp}）...`);
    const firewall = await ssh.execCommand(
      `set -e; ` +
      `if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then ` +
      `  if ufw status 2>/dev/null | grep -F -- ${shellQuote(entryIp)} | ` +
      `    grep -Eq '(^|[[:space:]])${exitPort}(/tcp)?([[:space:]]|$)'; then :; ` +
      `  else ufw allow from ${shellQuote(entryIp)} to any port ${exitPort} proto tcp ` +
      `    comment ${shellQuote(ruleComment)}; echo ${addedMarker}; fi; ` +
      `elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then ` +
      `  if firewall-cmd --permanent --query-rich-rule=${shellQuote(richRule)} >/dev/null 2>&1; then :; ` +
      `  else firewall-cmd --permanent --add-rich-rule=${shellQuote(richRule)}; ` +
      `    echo ${addedMarker}; firewall-cmd --reload; fi; ` +
      `elif command -v ${iptables} >/dev/null 2>&1; then ` +
      `  ${iptables} -C INPUT -s ${shellQuote(entryIp)} -p tcp --dport ${exitPort} -j ACCEPT 2>/dev/null || ` +
      `  { ${iptables} -I INPUT -s ${shellQuote(entryIp)} -p tcp --dport ${exitPort} ` +
      `    -m comment --comment ${shellQuote(ruleComment)} -j ACCEPT; echo ${addedMarker}; }; ` +
      `  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save; fi; ` +
      `else :; ` +
      `fi`,
    );
    if (firewall.code !== undefined && firewall.code !== 0) {
      if ((firewall.stdout ?? '').includes(addedMarker)) {
        try {
          await this.removeChainFirewallRuleRemote(ssh, entryIp, exitPort);
        } catch (rollbackErr) {
          const rollbackMessage = rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr);
          throw new DeploymentRollbackFailureError(
            `出口防火墙配置失败，且新增规则无法撤销: ${rollbackMessage}`,
          );
        }
      }
      throw new Error(
        `出口防火墙配置失败` +
        `${commandDetail(firewall.stdout, firewall.stderr) ?
          `: ${commandDetail(firewall.stdout, firewall.stderr)}` : ''}`,
      );
    }
    await this.cleanupDeploymentRollback(
      ssh,
      rollback,
      (message) => log(`[出口] ${message}`),
    );
    log(`[出口] 链式出口部署完成`);
    ssh.dispose();
  }

  private async rollbackChainExitDeployment(
    deployment: ChainExitDeployment,
    log: (msg: string) => void,
  ): Promise<boolean> {
    try {
      return await this.restoreDeploymentRollback(
        deployment.ssh,
        deployment.rollback,
        (message) => log(`[出口] ${message}`),
      );
    } finally {
      deployment.ssh.dispose();
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
    const certResult = await ssh.execCommand(
      `mkdir -p -- ${shellQuote(certDir)} && openssl req -x509 -newkey rsa:2048 ` +
      `-keyout ${shellQuote(keyFile)} -out ${shellQuote(certFile)} -days 3650 -nodes ` +
      `-subj ${shellQuote(`/CN=${cn}`)} -addext ${shellQuote(`subjectAltName=${san}`)} 2>&1 && ` +
      `chown root:root ${shellQuote(certFile)} ${shellQuote(keyFile)} && ` +
      `chmod 0644 ${shellQuote(certFile)} && chmod 0600 ${shellQuote(keyFile)}`,
    );
    if (certResult.code !== undefined && certResult.code !== 0) {
      throw new Error(
        `Unable to generate self-signed TLS certificate` +
        `${commandDetail(certResult.stdout, certResult.stderr) ?
          `: ${commandDetail(certResult.stdout, certResult.stderr)}` : ''}`,
      );
    }
    if (certResult.stderr) log(`TLS cert output: ${certResult.stderr}`);
    log(`TLS certificate ready`);
  }

  // ── Auto-install ─────────────────────────────────────────────────────────

  private async ensureCoreVersion(
    ssh: NodeSSH,
    bin: string,
    impl: string,
    minimumVersion: string,
    log: (msg: string) => void,
  ): Promise<string> {
    const readVersion = async (binary: string): Promise<string | null> => {
      const { code, stdout, stderr } = await ssh.execCommand(`${binary} version 2>&1`);
      if (code !== 0) return null;
      return extractStableCoreVersion(impl, `${stdout ?? ''}\n${stderr ?? ''}`);
    };

    let currentVersion = await readVersion(bin);
    if (currentVersion && compareSemanticVersions(currentVersion, minimumVersion) >= 0) {
      log(`${impl} version ${currentVersion} satisfies minimum ${minimumVersion}`);
      return bin;
    }

    log(
      `${impl} version ${currentVersion ?? 'unknown'} is below required ${minimumVersion}; ` +
      `upgrading to the latest stable release...`,
    );
    const hadPriorBinary = await binaryExists(ssh, bin);
    const backupPath = hadPriorBinary
      ? `${bin}.nextpanel-backup-${crypto.randomUUID()}`
      : null;

    if (backupPath) {
      const backupResult = await ssh.execCommand(
        `cp -p -- ${shellQuote(bin)} ${shellQuote(backupPath)} && ` +
        `test -x ${shellQuote(backupPath)}`,
      );
      if ((backupResult.code ?? 0) !== 0) {
        const detail = commandDetail(backupResult.stdout, backupResult.stderr);
        throw new Error(
          `Unable to back up existing ${impl} binary before upgrade` +
          `${detail ? `: ${detail}` : ''}`,
        );
      }
      log(`Backed up existing ${impl} binary to ${backupPath}`);
    }

    try {
      const resolvedBin = await this.autoInstall(ssh, impl, log);
      if (!resolvedBin || !(await binaryExists(ssh, resolvedBin))) {
        throw new Error(`Unable to install ${impl} >= ${minimumVersion}`);
      }

      currentVersion = await readVersion(resolvedBin);
      if (!currentVersion || compareSemanticVersions(currentVersion, minimumVersion) < 0) {
        throw new Error(
          `${impl} ${currentVersion ?? 'unknown'} does not meet required version ${minimumVersion}`,
        );
      }

      if (backupPath) {
        await this.preflightExistingCoreConfigs(ssh, bin, resolvedBin, impl, log);
        const cleanupResult = await ssh.execCommand(`rm -f -- ${shellQuote(backupPath)}`);
        if ((cleanupResult.code ?? 0) !== 0) {
          const detail = commandDetail(cleanupResult.stdout, cleanupResult.stderr);
          log(
            `Core backup cleanup warning; retained ${backupPath}` +
            `${detail ? `: ${detail}` : ''}`,
          );
        } else {
          log(`All existing ${impl} configs passed; removed upgrade backup`);
        }
      }

      log(`${impl} upgraded and verified: ${currentVersion}`);
      return resolvedBin;
    } catch (err) {
      if (!backupPath) throw err;

      const reason = err instanceof Error ? err.message : String(err);
      const restoreResult = await ssh.execCommand(
        `mv -f -- ${shellQuote(backupPath)} ${shellQuote(bin)}`,
      );
      if ((restoreResult.code ?? 0) !== 0) {
        const detail = commandDetail(restoreResult.stdout, restoreResult.stderr);
        throw new Error(
          `${reason}. Automatic ${impl} rollback failed; backup may remain at ${backupPath}` +
          `${detail ? `: ${detail}` : ''}`,
        );
      }

      log(`Upgrade failed; atomically restored the previous ${impl} binary`);
      throw new Error(`${reason}. Previous ${impl} binary restored.`);
    }
  }

  private async preflightExistingCoreConfigs(
    ssh: NodeSSH,
    unitBinary: string,
    validationBinary: string,
    impl: string,
    log: (msg: string) => void,
  ): Promise<void> {
    const listResult = await ssh.execCommand(
      `find /etc/systemd/system -maxdepth 1 \\( -type f -o -type l \\) ` +
      `-name 'nextpanel-*.service' -print`,
    );
    if ((listResult.code ?? 0) !== 0) {
      const detail = commandDetail(listResult.stdout, listResult.stderr);
      throw new Error(
        `Unable to enumerate existing NextPanel services for ${impl} compatibility preflight` +
        `${detail ? `: ${detail}` : ''}`,
      );
    }

    const unitPaths = (listResult.stdout ?? '')
      .split('\n')
      .map((path) => path.trim())
      .filter(Boolean);
    const failures: string[] = [];
    let checked = 0;

    for (const unitPath of unitPaths) {
      const unitResult = await ssh.execCommand(
        `sed -n '/^[[:space:]]*ExecStart=/p' -- ${shellQuote(unitPath)}`,
      );
      if ((unitResult.code ?? 0) !== 0) {
        const detail = commandDetail(unitResult.stdout, unitResult.stderr);
        failures.push(`${unitPath}: unable to read unit${detail ? ` (${detail})` : ''}`);
        continue;
      }

      for (const line of (unitResult.stdout ?? '').split('\n')) {
        const command = parseSystemdExecStart(line);
        if (!command || command.binary !== unitBinary) continue;
        if (!command.configPath) {
          failures.push(`${unitPath}: ExecStart does not reference a config via -config or -c`);
          continue;
        }

        checked += 1;
        const validationCommand = impl === 'SING_BOX'
          ? `${shellQuote(validationBinary)} check -c ${shellQuote(command.configPath)}`
          : `${shellQuote(validationBinary)} run -test -config ${shellQuote(command.configPath)}`;
        const result = await ssh.execCommand(`${validationCommand} 2>&1`);
        if ((result.code ?? 0) !== 0) {
          const detail = commandDetail(result.stdout, result.stderr) || `exit ${result.code}`;
          failures.push(`${unitPath} -> ${command.configPath}: ${detail}`);
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `${impl} upgrade compatibility preflight failed. ` +
        `Migrate these existing configs before retrying:\n${failures.join('\n')}`,
      );
    }
    log(`${impl} compatibility preflight passed for ${checked} existing config(s)`);
  }

  private async stageAndValidateConfig(
    ssh: NodeSSH,
    bin: string,
    impl: string,
    content: string,
    configPath: string,
    log: (msg: string) => void,
  ): Promise<string> {
    // Xray infers the config format from the filename unless -format is passed.
    // Keep a .json suffix while retaining a unique, non-stale staging path.
    const stagedPath = `${configPath}.next-${crypto.randomUUID()}.json`;
    const expectedChecksum = crypto.createHash('sha256').update(content).digest('hex');
    log(`Uploading staged config to ${stagedPath}...`);
    try {
      await uploadText(ssh, content, stagedPath);

      const checksumResult = await ssh.execCommand(`sha256sum -- ${stagedPath}`);
      const remoteChecksum = checksumResult.stdout?.trim().split(/\s+/)[0]?.toLowerCase();
      if (checksumResult.code !== 0 || remoteChecksum !== expectedChecksum) {
        const detail = `${checksumResult.stdout ?? ''}\n${checksumResult.stderr ?? ''}`.trim();
        throw new Error(
          `Staged config checksum verification failed${detail ? `: ${detail}` : ''}`,
        );
      }

      const validationCommand = impl === 'SING_BOX'
        ? `${bin} check -c ${stagedPath}`
        : `${bin} run -test -config ${stagedPath}`;
      const { code, stdout, stderr } = await ssh.execCommand(`${validationCommand} 2>&1`);
      if (code !== 0) {
        const detail = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
        throw new Error(`Config validation failed${detail ? `: ${detail}` : ''}`);
      }

      log(`Config checksum verified and validation passed at ${stagedPath}`);
      return stagedPath;
    } catch (err) {
      await this.cleanupStagedConfig(ssh, stagedPath, log);
      throw err;
    }
  }

  private async activateStagedConfig(
    ssh: NodeSSH,
    stagedPath: string,
    configPath: string,
    log: (msg: string) => void,
  ): Promise<void> {
    const { code: moveCode, stderr: moveError } = await ssh.execCommand(
      `mv -f ${stagedPath} ${configPath}`,
    );
    if (moveCode !== 0) {
      await this.cleanupStagedConfig(ssh, stagedPath, log);
      throw new Error(`Unable to activate validated config: ${moveError || 'mv failed'}`);
    }
    log(`Config validated and installed at ${configPath}`);
  }

  private async cleanupStagedConfig(
    ssh: NodeSSH,
    stagedPath: string,
    log: (msg: string) => void,
  ): Promise<void> {
    try {
      const { code, stderr } = await ssh.execCommand(`rm -f ${stagedPath}`);
      if (code !== 0) {
        log(`Staged config cleanup warning: ${stderr || `exit ${code}`}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Staged config cleanup warning: ${msg}`);
    }
  }

  private async prepareDeploymentRollback(
    ssh: NodeSSH,
    configPath: string,
    unitPath: string,
    serviceName: string,
    log: (msg: string) => void,
  ): Promise<DeploymentRollback> {
    const rollbackId = crypto.randomUUID();
    const rollback: DeploymentRollback = {
      configPath,
      unitPath,
      configBackupPath: `${configPath}.rollback-${rollbackId}`,
      unitBackupPath: `${unitPath}.rollback-${rollbackId}`,
      serviceName,
      hadConfig: false,
      hadUnit: false,
      wasActive: false,
      wasEnabled: false,
    };

    const cleanupPartialBackups = async () => {
      await ssh.execCommand(
        `rm -f -- ${shellQuote(rollback.configBackupPath)} ` +
        `${shellQuote(rollback.unitBackupPath)}`,
      );
    };

    const probeFile = async (path: string, label: string): Promise<boolean> => {
      const result = await ssh.execCommand(`test -f ${shellQuote(path)}`);
      if (result.code === 0) return true;
      if (result.code === 1) return false;
      const detail = commandDetail(result.stdout, result.stderr);
      throw new Error(
        `Unable to inspect existing ${label} before deployment` +
        `${detail ? `: ${detail}` : ''}`,
      );
    };

    try {
      rollback.hadConfig = await probeFile(configPath, 'config');
      if (rollback.hadConfig) {
        const result = await ssh.execCommand(
          `cp -p -- ${shellQuote(configPath)} ${shellQuote(rollback.configBackupPath)}`,
        );
        if (result.code !== 0) {
          const detail = commandDetail(result.stdout, result.stderr);
          throw new Error(
            `Unable to back up existing config before deployment` +
            `${detail ? `: ${detail}` : ''}`,
          );
        }
      }

      rollback.hadUnit = await probeFile(unitPath, 'systemd unit');
      if (rollback.hadUnit) {
        const result = await ssh.execCommand(
          `cp -p -- ${shellQuote(unitPath)} ${shellQuote(rollback.unitBackupPath)}`,
        );
        if (result.code !== 0) {
          const detail = commandDetail(result.stdout, result.stderr);
          throw new Error(
            `Unable to back up existing systemd unit before deployment` +
            `${detail ? `: ${detail}` : ''}`,
          );
        }
      }

      const activeResult = await ssh.execCommand(
        `systemctl is-active --quiet ${shellQuote(serviceName)}`,
      );
      rollback.wasActive = activeResult.code === 0;
      const enabledResult = await ssh.execCommand(
        `systemctl is-enabled --quiet ${shellQuote(serviceName)}`,
      );
      rollback.wasEnabled = enabledResult.code === 0;
      log(`Deployment rollback point prepared for ${serviceName}`);
      return rollback;
    } catch (err) {
      try {
        await cleanupPartialBackups();
      } catch {
        // Preserve the original snapshot error; unique partial backups are harmless.
      }
      throw err;
    }
  }

  private async restoreDeploymentRollback(
    ssh: NodeSSH,
    rollback: DeploymentRollback,
    log: (msg: string) => void,
  ): Promise<boolean> {
    const restoreConfig = rollback.hadConfig
      ? `cp -p -- ${shellQuote(rollback.configBackupPath)} ${shellQuote(rollback.configPath)}`
      : `rm -f -- ${shellQuote(rollback.configPath)}`;
    const restoreUnit = rollback.hadUnit
      ? `cp -p -- ${shellQuote(rollback.unitBackupPath)} ${shellQuote(rollback.unitPath)}`
      : `rm -f -- ${shellQuote(rollback.unitPath)}`;
    const restoreEnablement = rollback.hadUnit && rollback.wasEnabled
      ? `systemctl enable ${shellQuote(rollback.serviceName)} >/dev/null 2>&1 || failed=1`
      : `systemctl disable ${shellQuote(rollback.serviceName)} >/dev/null 2>&1 || true`;
    const restoreActivity = rollback.hadUnit && rollback.wasActive
      ? `systemctl start ${shellQuote(rollback.serviceName)} || failed=1`
      : ':';
    const command =
      `failed=0; ` +
      `systemctl stop ${shellQuote(rollback.serviceName)} 2>/dev/null || true; ` +
      `${restoreConfig} || failed=1; ` +
      `${restoreUnit} || failed=1; ` +
      `systemctl daemon-reload || failed=1; ` +
      `${restoreEnablement}; ` +
      `${restoreActivity}; ` +
      `exit "$failed"`;

    let lastDetail = '';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await ssh.execCommand(command);
        if (result.code !== 0) {
          lastDetail = commandDetail(result.stdout, result.stderr) || `exit ${result.code}`;
        } else if (rollback.hadUnit && rollback.wasActive) {
          const health = await ssh.execCommand(
            `systemctl is-active --quiet ${shellQuote(rollback.serviceName)}`,
          );
          if (health.code !== 0) {
            lastDetail =
              `restored service health check failed` +
              `${commandDetail(health.stdout, health.stderr) ?
                `: ${commandDetail(health.stdout, health.stderr)}` : ''}`;
          } else {
            await this.cleanupDeploymentRollback(ssh, rollback, log);
            log(`Previous deployment restored for ${rollback.serviceName}`);
            return true;
          }
        } else {
          await this.cleanupDeploymentRollback(ssh, rollback, log);
          log(`Previous deployment restored for ${rollback.serviceName}`);
          return true;
        }
      } catch (err) {
        lastDetail = err instanceof Error ? err.message : String(err);
      }

      if (attempt < 2) {
        log(
          `Deployment rollback attempt ${attempt} failed for ${rollback.serviceName}; retrying` +
          `${lastDetail ? `: ${lastDetail}` : ''}`,
        );
      }
    }

    log(
      `Deployment rollback failed for ${rollback.serviceName}; backups retained at ` +
      `${rollback.configBackupPath} and ${rollback.unitBackupPath}` +
      `${lastDetail ? `: ${lastDetail}` : ''}`,
    );
    return false;
  }

  private async cleanupDeploymentRollback(
    ssh: NodeSSH,
    rollback: DeploymentRollback,
    log: (msg: string) => void,
  ): Promise<void> {
    try {
      const result = await ssh.execCommand(
        `rm -f -- ${shellQuote(rollback.configBackupPath)} ` +
        `${shellQuote(rollback.unitBackupPath)}`,
      );
      if (result.code !== 0) {
        const detail = commandDetail(result.stdout, result.stderr);
        log(
          `Deployment backup cleanup warning for ${rollback.serviceName}` +
          `${detail ? `: ${detail}` : ''}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Deployment backup cleanup warning for ${rollback.serviceName}: ${message}`);
    }
  }

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

  /**
   * Ensure `unzip` is available on the remote host. Detects the host's package
   * manager and installs unzip if missing, then verifies. Returns false (with
   * diagnostic logs) when installation cannot succeed — callers MUST short-circuit
   * rather than letting downstream `unzip` invocations fail with a misleading
   * "command not found".
   */
  private async ensureUnzip(ssh: NodeSSH, log: (msg: string) => void): Promise<boolean> {
    const probe = await ssh.execCommand(`command -v unzip`);
    if (probe.code === 0) return true;

    log(`unzip not present, attempting install...`);
    // Try package managers in order. apt-get uses DPkg::Lock::Timeout to wait
    // for unattended-upgrades to release the lock instead of failing immediately.
    const installCmd =
      `if command -v apt-get >/dev/null 2>&1; then ` +
      `  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=120 install -y -qq unzip; ` +
      `elif command -v dnf >/dev/null 2>&1; then dnf install -y -q unzip; ` +
      `elif command -v yum >/dev/null 2>&1; then yum install -y -q unzip; ` +
      `elif command -v apk >/dev/null 2>&1; then apk add --no-cache unzip; ` +
      `elif command -v zypper >/dev/null 2>&1; then zypper -n install unzip; ` +
      `else echo "no supported package manager" 1>&2; exit 127; fi`;
    const { code, stderr } = await ssh.execCommand(installCmd);
    if (code !== 0 && stderr.trim()) {
      const tail = stderr.trim().split('\n').slice(-3).join(' | ');
      log(`unzip install error: ${tail}`);
    }

    const verify = await ssh.execCommand(`command -v unzip`);
    if (verify.code !== 0) {
      log(`unzip is still unavailable after install attempt — aborting.`);
      return false;
    }
    log(`unzip installed.`);
    return true;
  }

  private async installXray(ssh: NodeSSH, log: (msg: string) => void): Promise<boolean> {
    log(`Installing Xray...`);

    // Detect architecture
    const { stdout: uname } = await ssh.execCommand(`uname -m`);
    const archMap: Record<string, string> = { x86_64: '64', aarch64: 'arm64-v8a', armv7l: 'arm32-v7a' };
    const arch = archMap[uname.trim()];
    if (!arch) {
      log(`Unsupported Xray architecture: ${uname.trim() || 'unknown'}`);
      return false;
    }

    // Fetch latest release tag from GitHub
    const releaseResult = await ssh.execCommand(
      `curl -sf "https://api.github.com/repos/XTLS/Xray-core/releases/latest"`,
    );
    let tag: string;
    try {
      const release = JSON.parse(releaseResult.stdout ?? '') as { tag_name?: unknown };
      tag = typeof release.tag_name === 'string' ? release.tag_name : '';
    } catch {
      tag = '';
    }
    if ((releaseResult.code ?? 0) !== 0 || !/^v\d+\.\d+\.\d+$/.test(tag)) {
      log(`Failed to fetch a stable Xray release.`);
      return false;
    }
    log(`Latest Xray version: ${tag}, arch: ${arch}`);

    if (!(await this.ensureUnzip(ssh, log))) {
      log(`Xray install failed: unzip unavailable.`);
      return false;
    }

    // Verify the release's official .dgst before extracting. The candidate is
    // executed from a same-filesystem staging path before atomic activation.
    const zipName = `Xray-linux-${arch}.zip`;
    const url = `https://github.com/XTLS/Xray-core/releases/download/${tag}/${zipName}`;
    const installId = crypto.randomUUID();
    const tempDir = `/tmp/nextpanel-xray-${installId}`;
    const archive = `${tempDir}/${zipName}`;
    const digestFile = `${archive}.dgst`;
    const stagedBin = `/usr/local/bin/.xray.nextpanel-${installId}`;
    const expectedVersion = tag.slice(1).replace(/\./g, '\\.');
    const installResult = await ssh.execCommand(
      `set -eu; ` +
      `cleanup() { rm -rf -- ${shellQuote(tempDir)}; rm -f -- ${shellQuote(stagedBin)}; }; ` +
      `trap cleanup EXIT HUP INT TERM; ` +
      `mkdir -m 0700 -- ${shellQuote(tempDir)}; ` +
      `curl -fsSL --retry 3 -o ${shellQuote(archive)} ${shellQuote(url)}; ` +
      `curl -fsSL --retry 3 -o ${shellQuote(digestFile)} ${shellQuote(`${url}.dgst`)}; ` +
      `expected="$(grep -E '^SHA2-256= [0-9A-Fa-f]{64}$' ${shellQuote(digestFile)} | ` +
      `head -n 1 | cut -d ' ' -f 2)"; ` +
      `test -n "$expected"; ` +
      `printf '%s  %s\n' "$expected" ${shellQuote(archive)} | sha256sum -c -; ` +
      `unzip -oq ${shellQuote(archive)} xray -d ${shellQuote(tempDir)}; ` +
      `install -m 0755 ${shellQuote(`${tempDir}/xray`)} ${shellQuote(stagedBin)}; ` +
      `${shellQuote(stagedBin)} version 2>&1 | ` +
      `grep -Eq '^Xray[[:space:]]+v?${expectedVersion}([[:space:]]|\\()'; ` +
      `mv -f -- ${shellQuote(stagedBin)} /usr/local/bin/xray`,
    );
    if ((installResult.code ?? 0) !== 0) {
      const detail = commandDetail(installResult.stdout, installResult.stderr);
      if (detail) log(`Xray verified install failed: ${detail}`);
      log(`Xray install failed.`);
      return false;
    }

    const { code } = await ssh.execCommand(`test -x /usr/local/bin/xray`);
    if (code === 0) { log(`Xray installed successfully.`); return true; }
    log(`Xray install failed.`);
    return false;
  }

  private async installV2Ray(ssh: NodeSSH, log: (msg: string) => void): Promise<boolean> {
    log(`Installing V2Ray via official script...`);
    if (!(await this.ensureUnzip(ssh, log))) {
      log(`V2Ray install failed: unzip unavailable.`);
      return false;
    }
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
    const arch = archMap[uname.trim()];
    if (!arch) {
      log(`Unsupported sing-box architecture: ${uname.trim() || 'unknown'}`);
      return false;
    }
    log(`Architecture: ${uname.trim()} → ${arch}`);

    log(`Fetching latest sing-box version from GitHub...`);
    const releaseResult = await ssh.execCommand(
      `curl -sf "https://api.github.com/repos/SagerNet/sing-box/releases/latest"`,
    );
    type SingBoxRelease = {
      tag_name?: unknown;
      assets?: Array<{ name?: unknown; state?: unknown; digest?: unknown }>;
    };
    let release: SingBoxRelease | null = null;
    try {
      release = JSON.parse(releaseResult.stdout ?? '') as SingBoxRelease;
    } catch {
      // Handled by the validation below.
    }
    const tag = typeof release?.tag_name === 'string' ? release.tag_name : '';
    if ((releaseResult.code ?? 0) !== 0 || !/^v\d+\.\d+\.\d+$/.test(tag)) {
      log(`Failed to fetch a stable sing-box release.`);
      return false;
    }
    const version = tag.slice(1);
    log(`Latest version: ${version}`);

    const tarName = `sing-box-${version}-linux-${arch}.tar.gz`;
    const asset = release?.assets?.find((candidate) => candidate.name === tarName);
    const digestMatch = typeof asset?.digest === 'string'
      ? asset.digest.match(/^sha256:([0-9a-f]{64})$/i)
      : null;
    if (asset?.state !== 'uploaded' || !digestMatch) {
      log(`Official SHA-256 digest is unavailable for ${tarName}.`);
      return false;
    }

    const expectedDigest = digestMatch[1].toLowerCase();
    const url = `https://github.com/SagerNet/sing-box/releases/download/${tag}/${tarName}`;
    log(`Downloading ${tarName}...`);

    const installId = crypto.randomUUID();
    const tempDir = `/tmp/nextpanel-sing-box-${installId}`;
    const archive = `${tempDir}/${tarName}`;
    const extractedBin = `${tempDir}/sing-box-${version}-linux-${arch}/sing-box`;
    const stagedBin = `/usr/local/bin/.sing-box.nextpanel-${installId}`;
    const expectedVersion = version.replace(/\./g, '\\.');
    const installResult = await ssh.execCommand(
      `set -eu; ` +
      `cleanup() { rm -rf -- ${shellQuote(tempDir)}; rm -f -- ${shellQuote(stagedBin)}; }; ` +
      `trap cleanup EXIT HUP INT TERM; ` +
      `mkdir -m 0700 -- ${shellQuote(tempDir)}; ` +
      `curl -fsSL --retry 3 -o ${shellQuote(archive)} ${shellQuote(url)}; ` +
      `printf '%s  %s\n' '${expectedDigest}' ${shellQuote(archive)} | sha256sum -c -; ` +
      `tar xzf ${shellQuote(archive)} -C ${shellQuote(tempDir)}; ` +
      `install -m 0755 ${shellQuote(extractedBin)} ${shellQuote(stagedBin)}; ` +
      `${shellQuote(stagedBin)} version 2>&1 | ` +
      `grep -Eq '^sing-box version[[:space:]]+v?${expectedVersion}([[:space:]]|$)'; ` +
      `mv -f -- ${shellQuote(stagedBin)} /usr/local/bin/sing-box`,
    );
    if ((installResult.code ?? 0) !== 0) {
      const detail = commandDetail(installResult.stdout, installResult.stderr);
      if (detail) log(`sing-box verified install failed: ${detail}`);
      log(`sing-box install failed.`);
      return false;
    }

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

  private async cleanupMainNodeRemote(
    ssh: NodeSSH,
    nodeId: string,
    log?: (msg: string) => void,
  ): Promise<void> {
    const serviceName = `nextpanel-${nodeId}`;
    const unitPath = `/etc/systemd/system/${serviceName}.service`;
    const configPath = `/etc/nextpanel/nodes/${nodeId}.json`;
    const result = await ssh.execCommand(
      `set -eu; ` +
      `systemctl stop ${shellQuote(serviceName)} 2>/dev/null || true; ` +
      `systemctl disable ${shellQuote(serviceName)} 2>/dev/null || true; ` +
      `rm -f -- ${shellQuote(unitPath)} ${shellQuote(configPath)}; ` +
      `systemctl daemon-reload; ` +
      `! systemctl is-active --quiet ${shellQuote(serviceName)}; ` +
      `! systemctl is-enabled --quiet ${shellQuote(serviceName)}; ` +
      `test ! -e ${shellQuote(unitPath)} && test ! -e ${shellQuote(configPath)}`,
    );
    if ((result.code ?? 0) !== 0) {
      throw new Error(
        `主节点远程清理未通过验证` +
        `${commandDetail(result.stdout, result.stderr) ?
          `: ${commandDetail(result.stdout, result.stderr)}` : ''}`,
      );
    }
    log?.('主节点服务、单元和配置已验证清理');
  }

  private async cleanupChainExitRemote(
    ssh: NodeSSH,
    nodeId: string,
    entryIp: string,
    exitPort: number,
    log?: (msg: string) => void,
  ): Promise<void> {
    const serviceName = `nextpanel-chain-${nodeId}`;
    const unitPath = `/etc/systemd/system/${serviceName}.service`;
    const configPath = `/etc/nextpanel/nodes/chain-${nodeId}.json`;
    const cleanup = await ssh.execCommand(
      `set -eu; ` +
      `systemctl stop ${shellQuote(serviceName)} 2>/dev/null || true; ` +
      `systemctl disable ${shellQuote(serviceName)} 2>/dev/null || true; ` +
      `rm -f -- ${shellQuote(unitPath)} ${shellQuote(configPath)}; ` +
      `systemctl daemon-reload; ` +
      `! systemctl is-active --quiet ${shellQuote(serviceName)}; ` +
      `! systemctl is-enabled --quiet ${shellQuote(serviceName)}; ` +
      `test ! -e ${shellQuote(unitPath)} && test ! -e ${shellQuote(configPath)}`,
    );
    if ((cleanup.code ?? 0) !== 0) {
      throw new Error(
        `链式出口服务清理未通过验证` +
        `${commandDetail(cleanup.stdout, cleanup.stderr) ?
          `: ${commandDetail(cleanup.stdout, cleanup.stderr)}` : ''}`,
      );
    }

    await this.removeChainFirewallRuleRemote(ssh, entryIp, exitPort);
    log?.('链式出口服务、配置和防火墙规则已验证清理');
  }

  private async removeChainFirewallRuleRemote(
    ssh: NodeSSH,
    entryIp: string,
    exitPort: number,
  ): Promise<void> {
    const addressFamily = entryIp.includes(':') ? 'ipv6' : 'ipv4';
    const iptables = addressFamily === 'ipv6' ? 'ip6tables' : 'iptables';
    const ruleComment = 'nextpanel-chain-managed';
    const richRule =
      `rule family="${addressFamily}" priority="-27182" source address="${entryIp}" ` +
      `port protocol="tcp" port="${exitPort}" accept`;
    const firewall = await ssh.execCommand(
      `set -eu; ` +
      `if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then ` +
      `  if ufw status 2>/dev/null | grep -F -- ${shellQuote(entryIp)} | ` +
      `    grep -E '(^|[[:space:]])${exitPort}(/tcp)?([[:space:]]|$)' | grep -Fq -- '# ${ruleComment}'; then ` +
      `    ufw --force delete allow from ${shellQuote(entryIp)} to any port ${exitPort} proto tcp ` +
      `      comment ${shellQuote(ruleComment)} >/dev/null; ` +
      `  fi; ` +
      `  ! ufw status 2>/dev/null | grep -F -- ${shellQuote(entryIp)} | ` +
      `    grep -E '(^|[[:space:]])${exitPort}(/tcp)?([[:space:]]|$)' | grep -Fq -- '# ${ruleComment}'; ` +
      `elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then ` +
      `  if firewall-cmd --permanent --query-rich-rule=${shellQuote(richRule)} >/dev/null 2>&1; then ` +
      `    firewall-cmd --permanent --remove-rich-rule=${shellQuote(richRule)} && firewall-cmd --reload; ` +
      `  fi; ` +
      `  ! firewall-cmd --permanent --query-rich-rule=${shellQuote(richRule)} >/dev/null 2>&1; ` +
      `elif command -v ${iptables} >/dev/null 2>&1; then ` +
      `  while ${iptables} -C INPUT -s ${shellQuote(entryIp)} -p tcp --dport ${exitPort} ` +
      `    -m comment --comment ${shellQuote(ruleComment)} -j ACCEPT 2>/dev/null; do ` +
      `    ${iptables} -D INPUT -s ${shellQuote(entryIp)} -p tcp --dport ${exitPort} ` +
      `      -m comment --comment ${shellQuote(ruleComment)} -j ACCEPT; ` +
      `  done; ` +
      `  ! ${iptables} -C INPUT -s ${shellQuote(entryIp)} -p tcp --dport ${exitPort} ` +
      `    -m comment --comment ${shellQuote(ruleComment)} -j ACCEPT 2>/dev/null; ` +
      `  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save; fi; ` +
      `fi`,
    );
    if ((firewall.code ?? 0) !== 0) {
      throw new Error(
        `链式出口防火墙规则清理未通过验证` +
        `${commandDetail(firewall.stdout, firewall.stderr) ?
          `: ${commandDetail(firewall.stdout, firewall.stderr)}` : ''}`,
      );
    }
  }

  /**
   * Returns the transport protocols that need firewall rules for a given proxy protocol.
   * - HYSTERIA2 / TUIC: UDP only (QUIC-based)
   * - ANYTLS: TCP only
   * - SHADOWSOCKS: TCP + UDP (xray: network:'tcp,udp', ss-libev: mode:'tcp_and_udp')
   * - SOCKS5: TCP + UDP (xray: udp:true)
   * - All others (VLESS, VMESS, TROJAN, HTTP): TCP only
   */
  private getFirewallProtocols(protocol: string): ('tcp' | 'udp')[] {
    if (protocol === 'HYSTERIA2' || protocol === 'TUIC') return ['udp'];
    if (protocol === 'SHADOWSOCKS' || protocol === 'SOCKS5') return ['tcp', 'udp'];
    return ['tcp'];
  }

  private getPrimarySocketProtocol(protocol: string): 'tcp' | 'udp' {
    return protocol === 'HYSTERIA2' || protocol === 'TUIC' ? 'udp' : 'tcp';
  }

  /** Open a firewall port via ufw, firewalld, or iptables. */
  private async openFirewallPort(
    ssh: NodeSSH,
    port: number,
    proto: 'tcp' | 'udp',
    log?: (msg: string) => void,
    failClosed = false,
    serverIp = '',
  ): Promise<FirewallChange> {
    const iptables = serverIp.includes(':') ? 'ip6tables' : 'iptables';
    const addedMarker = '__NEXTPANEL_FIREWALL_ADDED__';
    const ruleComment = 'nextpanel-managed';
    const firewalldService = `nextpanel-${proto}-${port}`;
    log?.(`Opening firewall port ${port}/${proto}...`);
    // If ufw is active, delegate entirely to ufw (mixing ufw + raw iptables
    // breaks ufw chains). Otherwise use firewalld or direct iptables.
    const result = await ssh.execCommand(
      `set -e; ` +
      `if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then ` +
      `  if ufw status 2>/dev/null | grep -Eq '(^|[[:space:]])${port}/${proto}([[:space:]]|$)'; then :; ` +
      `  else ufw allow ${port}/${proto} comment ${shellQuote(ruleComment)}; echo ${addedMarker}; fi; ` +
      `elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then ` +
      `  changed=0; ` +
      `  if ! firewall-cmd --permanent --info-service=${firewalldService} >/dev/null 2>&1; then ` +
      `    firewall-cmd --permanent --new-service=${firewalldService}; echo ${addedMarker}; changed=1; ` +
      `  fi; ` +
      `  if ! firewall-cmd --permanent --service=${firewalldService} --query-port=${port}/${proto} >/dev/null 2>&1; then ` +
      `    firewall-cmd --permanent --service=${firewalldService} --add-port=${port}/${proto}; echo ${addedMarker}; changed=1; ` +
      `  fi; ` +
      `  if ! firewall-cmd --permanent --query-service=${firewalldService} >/dev/null 2>&1; then ` +
      `    firewall-cmd --permanent --add-service=${firewalldService}; echo ${addedMarker}; changed=1; ` +
      `  fi; ` +
      `  if [ "$changed" -eq 1 ]; then firewall-cmd --reload; fi; ` +
      `elif command -v ${iptables} >/dev/null 2>&1; then ` +
      `  ${iptables} -C INPUT -p ${proto} --dport ${port} -j ACCEPT 2>/dev/null || ` +
      `  { ${iptables} -I INPUT -p ${proto} --dport ${port} -m comment --comment ${shellQuote(ruleComment)} -j ACCEPT; echo ${addedMarker}; }; ` +
      `  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save; fi; ` +
      `else :; ` +
      `fi`,
    );
    const added = (result.stdout ?? '').includes(addedMarker);
    if (result.code !== undefined && result.code !== 0) {
      const message =
        `Failed to open firewall port ${port}/${proto}` +
        `${commandDetail(result.stdout, result.stderr) ?
          `: ${commandDetail(result.stdout, result.stderr)}` : ''}`;
      if (added) {
        try {
          await this.closeFirewallPort(ssh, port, proto, log, serverIp, true);
        } catch (rollbackErr) {
          const rollbackMessage = rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr);
          throw new DeploymentRollbackFailureError(
            `${message}; firewall rollback failed: ${rollbackMessage}`,
          );
        }
      }
      if (failClosed) throw new Error(message);
      log?.(`Firewall warning (deployment kept active): ${message}`);
      return { added: false, rollback: async () => true };
    }
    log?.(`Firewall: port ${port}/${proto} opened`);
    return {
      added,
      rollback: async () => {
        if (added) {
          await this.closeFirewallPort(ssh, port, proto, log, serverIp, true);
        }
        return true;
      },
    };
  }

  private async rollbackFirewallChanges(
    changes: FirewallChange[],
    log: (msg: string) => void,
  ): Promise<boolean> {
    let restored = true;
    for (const change of [...changes].reverse()) {
      try {
        const current = await change.rollback();
        restored = current && restored;
      } catch (err) {
        restored = false;
        const message = err instanceof Error ? err.message : String(err);
        log(`Firewall rollback failed: ${message}`);
      }
    }
    return restored;
  }

  /** Close a firewall port and verify that no matching rule remains. */
  private async closeFirewallPort(
    ssh: NodeSSH,
    port: number,
    proto: 'tcp' | 'udp',
    log?: (msg: string) => void,
    serverIp = '',
    failClosed = false,
  ): Promise<void> {
    const iptables = serverIp.includes(':') ? 'ip6tables' : 'iptables';
    const ruleComment = 'nextpanel-managed';
    const firewalldService = `nextpanel-${proto}-${port}`;
    log?.(`Closing firewall port ${port}/${proto}...`);
    try {
      const result = await ssh.execCommand(
        `set -e; ` +
        `if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then ` +
        `  if ufw status 2>/dev/null | grep -E '(^|[[:space:]])${port}/${proto}([[:space:]]|$)' | grep -Fq -- '# ${ruleComment}'; then ` +
        `    ufw --force delete allow ${port}/${proto} comment ${shellQuote(ruleComment)} >/dev/null; ` +
        `  fi; ` +
        `  ! ufw status 2>/dev/null | grep -E '(^|[[:space:]])${port}/${proto}([[:space:]]|$)' | grep -Fq -- '# ${ruleComment}'; ` +
        `elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state 2>/dev/null | grep -q running; then ` +
        `  changed=0; ` +
        `  if firewall-cmd --permanent --query-service=${firewalldService} >/dev/null 2>&1; then ` +
        `    firewall-cmd --permanent --remove-service=${firewalldService} >/dev/null; changed=1; ` +
        `  fi; ` +
        `  if firewall-cmd --permanent --info-service=${firewalldService} >/dev/null 2>&1; then ` +
        `    firewall-cmd --permanent --delete-service=${firewalldService} >/dev/null; changed=1; ` +
        `  fi; ` +
        `  if [ "$changed" -eq 1 ]; then firewall-cmd --reload >/dev/null; fi; ` +
        `  ! firewall-cmd --permanent --query-service=${firewalldService} >/dev/null 2>&1; ` +
        `  ! firewall-cmd --permanent --info-service=${firewalldService} >/dev/null 2>&1; ` +
        `elif command -v ${iptables} >/dev/null 2>&1; then ` +
        `  while ${iptables} -C INPUT -p ${proto} --dport ${port} -m comment --comment ${shellQuote(ruleComment)} -j ACCEPT 2>/dev/null; do ` +
        `    ${iptables} -D INPUT -p ${proto} --dport ${port} -m comment --comment ${shellQuote(ruleComment)} -j ACCEPT; ` +
        `  done; ` +
        `  ! ${iptables} -C INPUT -p ${proto} --dport ${port} -m comment --comment ${shellQuote(ruleComment)} -j ACCEPT 2>/dev/null; ` +
        `  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null; fi; ` +
        `else :; ` +
        `fi`,
      );
      if ((result.code ?? 0) !== 0) {
        throw new Error(
          `Failed to close firewall port ${port}/${proto}` +
          `${commandDetail(result.stdout, result.stderr) ?
            `: ${commandDetail(result.stdout, result.stderr)}` : ''}`,
        );
      }
      log?.(`Firewall: port ${port}/${proto} closed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (failClosed) throw err;
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
    protocol: 'tcp' | 'udp' = 'tcp',
  ): Promise<void> {
    const { stdout: pidRaw } = await ssh.execCommand(
      `fuser ${port}/${protocol} 2>/dev/null || true`,
    );
    const pids = (pidRaw ?? '').trim().split(/\s+/).filter(Boolean);
    if (pids.length === 0) return;
    if (pids.some((pid) => !/^\d+$/.test(pid))) {
      throw new Error(`${label} port ${port} returned an invalid owner PID list`);
    }

    const PROXY_BINS = new Set(['xray', 'sing-box', 'hysteria', 'hysteria2', 'v2ray']);
    for (const pid of pids) {
      const { stdout: commRaw } = await ssh.execCommand(
        `cat /proc/${pid}/comm 2>/dev/null || true`,
      );
      const comm = commRaw?.trim();
      if (!PROXY_BINS.has(comm ?? '')) {
        throw new Error(
          `${label} port ${port} is owned by ${comm || 'an unknown process'} (PID ${pid}); refusing to terminate it`,
        );
      }

      const { stdout: unitRaw } = await ssh.execCommand(
        `sed -n 's#.*\\(/nextpanel-[^/]*\\.service\\).*#\\1#p' /proc/${pid}/cgroup 2>/dev/null | ` +
        `sed 's#^/##' | head -n 1`,
      );
      const unit = unitRaw?.trim();
      if (unit) {
        throw new Error(
          `${label} port ${port} is owned by managed service ${unit} (PID ${pid}); refusing to terminate it`,
        );
      }

      log(`${label} port ${port} occupied by orphaned ${comm} (PID ${pid}), killing...`);
      const killed = await ssh.execCommand(`kill -9 ${pid} 2>/dev/null`);
      if (killed.code !== 0) {
        throw new Error(`${label} port ${port} owner PID ${pid} could not be terminated`);
      }
      await new Promise((r) => setTimeout(r, 300));
      log(`Orphaned process killed, ${label} port ${port} freed`);
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
    const encryptedConfig = this.crypto.encrypt(configJson);
    // Hash only the encrypted envelope. Hashing plaintext would provide an
    // offline password oracle to anyone who can read a database backup.
    const checksum = crypto
      .createHash('sha256')
      .update(encryptedConfig)
      .digest('hex');

    // P2003 = FK constraint (node deleted), P2025 = record not found — both mean node is gone
    const ignoreDeletedNode = (e: unknown) => {
      const code = (e as { code?: string })?.code;
      if (code === 'P2003' || code === 'P2025') return;
      throw e;
    };

    const createSnapshot = async (): Promise<void> => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const last = await this.prisma.configSnapshot.findFirst({
          where: { nodeId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        try {
          await this.prisma.configSnapshot.create({
            data: {
              nodeId,
              version: (last?.version ?? 0) + 1,
              content: encryptedConfig,
              checksum,
              deployLog: logs.join('\n'),
            },
          });
          return;
        } catch (err) {
          const code = (err as { code?: string })?.code;
          if (code === 'P2003' || code === 'P2025') return;
          if (code !== 'P2002' || attempt === 3) throw err;
        }
      }
    };

    await Promise.all([
      createSnapshot(),
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

interface ParsedCoreExecStart {
  binary: string;
  configPath: string | null;
}

interface DeploymentRollback {
  configPath: string;
  unitPath: string;
  configBackupPath: string;
  unitBackupPath: string;
  serviceName: string;
  hadConfig: boolean;
  hadUnit: boolean;
  wasActive: boolean;
  wasEnabled: boolean;
}

interface ChainExitDeployment {
  ssh: NodeSSH;
  rollback: DeploymentRollback;
  entryIp: string;
  exitPort: number;
}

class DeploymentRollbackFailureError extends Error {
  readonly rollbackFailed = true;

  constructor(message: string) {
    super(message);
    this.name = 'DeploymentRollbackFailureError';
  }
}

function isDeploymentRollbackFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { rollbackFailed?: boolean }).rollbackFailed === true
  );
}

function parseSystemdExecStart(line: string): ParsedCoreExecStart | null {
  const executable = line.match(
    /^\s*ExecStart=[-@:+!]*(?:"([^"]+)"|'([^']+)'|(\S+))/,
  );
  if (!executable) return null;

  const config = line.match(
    /(?:^|\s)-(?:config|c)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/,
  );
  return {
    binary: executable[1] ?? executable[2] ?? executable[3],
    configPath: config ? (config[1] ?? config[2] ?? config[3]) : null,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function commandDetail(stdout?: string, stderr?: string): string {
  const detail = `${stdout ?? ''}\n${stderr ?? ''}`
    .trim()
    .replace(/\s*\n\s*/g, ' | ');
  return detail.length > 1500 ? `${detail.slice(0, 1500)}...` : detail;
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

interface FirewallChange {
  added: boolean;
  rollback(): Promise<boolean>;
}

interface CoreVersionRequirement {
  implementation: 'XRAY' | 'SING_BOX';
  minimumVersion: string;
}

interface ChainCredentials {
  uuid: string;
  realityPrivateKey?: string;
  realityPublicKey?: string;
  shortId?: string;
}

function parseChainCredentials(value: string): ChainCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Legacy chain nodes stored only the raw UUID.
    return { uuid: value };
  }

  if (typeof parsed === 'string') return { uuid: parsed };
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid chain credential payload');
  }

  const record = parsed as Record<string, unknown>;
  const uuid = typeof record.uuid === 'string' ? record.uuid : '';
  const realityPrivateKey = typeof record.realityPrivateKey === 'string'
    ? record.realityPrivateKey
    : undefined;
  const realityPublicKey = typeof record.realityPublicKey === 'string'
    ? record.realityPublicKey
    : undefined;
  const shortId = typeof record.shortId === 'string' ? record.shortId : undefined;
  if (!uuid) throw new Error('Chain credential UUID is missing');

  const realityValues = [realityPrivateKey, realityPublicKey, shortId];
  const hasAnyReality = realityValues.some(Boolean);
  const hasAllReality = realityValues.every(Boolean);
  if (hasAnyReality && !hasAllReality) {
    throw new Error('Secure chain credentials are incomplete');
  }
  if (shortId && !/^[0-9a-f]{16}$/i.test(shortId)) {
    throw new Error('Secure chain short ID must be 16 hexadecimal characters');
  }

  return { uuid, realityPrivateKey, realityPublicKey, shortId };
}

function getCoreVersionRequirement(
  protocol: string,
  transport: string | null,
): CoreVersionRequirement | null {
  if (protocol === 'VLESS' && transport === 'XHTTP') {
    return { implementation: 'XRAY', minimumVersion: '25.3.6' };
  }
  if (protocol === 'TUIC' || protocol === 'ANYTLS') {
    return { implementation: 'SING_BOX', minimumVersion: '1.12.0' };
  }
  return null;
}

function extractStableCoreVersion(implementation: string, output: string): string | null {
  const pattern = implementation === 'SING_BOX'
    ? /^sing-box version\s+v?(\d+\.\d+\.\d+)(?=\s|$)/m
    : /^Xray\s+v?(\d+\.\d+\.\d+)(?=\s|\(|$)/m;
  return output.match(pattern)?.[1] ?? null;
}

function compareSemanticVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function buildSystemdUnit(name: string, bin: string, args: string): string {
  const safeName = Array.from(name, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  }).join('').replace(/\s+/g, ' ').trim().slice(0, 128) || 'Unnamed node';
  return [
    '[Unit]',
    `Description=NextPanel Node: ${safeName}`,
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
