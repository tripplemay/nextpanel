import * as crypto from 'crypto';
import { Injectable, Logger, MessageEvent, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NodeSSH } from 'node-ssh';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
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
  ) {}

  /** Stream deploy logs as SSE events */
  deployStream(nodeId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const onLog = (line: string) => {
        subscriber.next({ data: { log: line } } as MessageEvent);
      };

      this.deploy(nodeId, onLog)
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

  async deploy(nodeId: string, onLog?: (line: string) => void): Promise<DeployResult> {
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
          await this.finalize(nodeId, false, logs, configJson);
          return { success: false, log: logs.join('\n') };
        }
        // Re-verify — use resolved path (may differ from default for ss-libev)
        if (!(await binaryExists(ssh, resolvedBin))) {
          log(`Binary still not found at ${resolvedBin} after install. Aborting.`);
          ssh.dispose();
          await this.finalize(nodeId, false, logs, configJson);
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

      // ── 5. Upload config file (base64 to avoid shell escaping issues) ──────
      log(`Uploading config to ${configPath}...`);
      await uploadText(ssh, configJson, configPath);
      log(`Config uploaded to ${configPath}`);

      // ── 6. Write systemd unit ──────────────────────────────────────────────
      const unitContent = buildSystemdUnit(node.name, bin, args);
      const unitPath = `/etc/systemd/system/${serviceName}.service`;
      log(`Writing systemd unit to ${unitPath}...`);
      await uploadText(ssh, unitContent, unitPath);
      log(`Systemd unit written`);

      // ── 7. Enable & restart service ────────────────────────────────────────
      log(`Reloading systemd daemon...`);
      const { stderr: reloadErr } = await ssh.execCommand('systemctl daemon-reload');
      if (reloadErr) log(`daemon-reload warning: ${reloadErr}`);

      log(`Starting service: ${serviceName}...`);
      const { stderr: startErr } = await ssh.execCommand(
        `systemctl enable --now ${serviceName} && systemctl restart ${serviceName}`,
      );
      if (startErr) log(`Start warning: ${startErr}`);

      // ── 8. Verify service is active ────────────────────────────────────────
      log(`Waiting for service to stabilize...`);
      await new Promise((r) => setTimeout(r, 2000));
      const { stdout: activeOut } = await ssh.execCommand(
        `systemctl is-active ${serviceName}`,
      );
      const isActive = activeOut.trim() === 'active';
      log(`Service status: ${activeOut.trim()}`);

      ssh.dispose();
      await this.finalize(nodeId, isActive, logs, configJson);

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
      await this.finalize(nodeId, false, logs, configJson);
      return { success: false, log: logs.join('\n') };
    }
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
    } catch {
      ssh?.dispose();
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
    const { stdout, stderr } = await ssh.execCommand(
      `bash <(curl -sL https://github.com/XTLS/Xray-install/raw/main/install-release.sh) @ install 2>&1`,
      { execOptions: { pty: false } },
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
      `bash <(curl -sL https://raw.githubusercontent.com/v2fly/fhs-install-v2ray/master/install-release.sh) 2>&1`,
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
    success: boolean,
    logs: string[],
    configJson: string,
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
        data: { nodeId, version, content: configJson, checksum },
      }),
      this.prisma.node.update({
        where: { id: nodeId },
        data: { status: success ? 'RUNNING' : 'ERROR' },
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
