/**
 * CertService — manages Let's Encrypt wildcard certificates on the panel server.
 *
 * Uses acme.sh with Cloudflare DNS-01 challenge to issue/renew *.{domain} certs.
 * Certs are stored locally and pushed to node servers via SFTP during deployment.
 */

import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { Injectable, Logger } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';

const ACME_HOME = path.join(os.homedir(), '.acme.sh');
const ACME_BIN = path.join(ACME_HOME, 'acme.sh');

@Injectable()
export class CertService {
  private readonly logger = new Logger(CertService.name);

  /**
   * Ensure a wildcard LE cert for *.{baseDomain} is issued and valid.
   * Issues a new cert if none exists or if it expires within 30 days.
   */
  async ensureWildcardCert(
    cfApiToken: string,
    baseDomain: string,
    log: (msg: string) => void,
  ): Promise<{ certPath: string; keyPath: string }> {
    await this.ensureAcmeInstalled(log);

    const { certPath, keyPath } = this.getCertPaths(baseDomain);

    if (await this.isCertValid(certPath)) {
      log(`Wildcard cert for *.${baseDomain} is valid`);
      return { certPath, keyPath };
    }

    log(`Issuing wildcard cert for *.${baseDomain} via Let's Encrypt DNS-01...`);
    await this.runAcme(
      ['--issue', '--dns', 'dns_cf', '-d', `*.${baseDomain}`, '--server', 'letsencrypt'],
      { CF_Token: cfApiToken },
      log,
    );
    log(`Wildcard cert issued for *.${baseDomain}`);
    return { certPath, keyPath };
  }

  /**
   * Renew a wildcard cert if it expires within 30 days.
   * Returns true if renewal was performed, false if still valid.
   */
  async renewWildcardCert(
    cfApiToken: string,
    baseDomain: string,
    log: (msg: string) => void,
  ): Promise<boolean> {
    const { certPath } = this.getCertPaths(baseDomain);

    if (await this.isCertValid(certPath)) {
      log(`Cert for *.${baseDomain} is still valid, skipping renewal`);
      return false;
    }

    log(`Renewing wildcard cert for *.${baseDomain}...`);
    await this.runAcme(
      ['--renew', '-d', `*.${baseDomain}`],
      { CF_Token: cfApiToken },
      log,
    );
    log(`Cert renewed for *.${baseDomain}`);
    return true;
  }

  /**
   * Push cert + key to a node server via SFTP.
   * Remote paths: /etc/nextpanel/certs/{nodeId}.crt and .key
   */
  async pushCertToNode(
    ssh: NodeSSH,
    nodeId: string,
    baseDomain: string,
    log: (msg: string) => void,
  ): Promise<void> {
    const { certPath, keyPath } = this.getCertPaths(baseDomain);
    const remoteDir = '/etc/nextpanel/certs';
    const remoteCert = `${remoteDir}/${nodeId}.crt`;
    const remoteKey = `${remoteDir}/${nodeId}.key`;

    log(`Pushing LE cert to node server...`);
    await ssh.execCommand(`mkdir -p ${remoteDir}`);
    await ssh.putFile(certPath, remoteCert);
    await ssh.putFile(keyPath, remoteKey);
    log(`LE cert deployed to ${remoteCert}`);
  }

  /** Return local paths to acme.sh's ECC cert files for a wildcard domain. */
  getCertPaths(baseDomain: string): { certPath: string; keyPath: string } {
    const certDir = path.join(ACME_HOME, `*.${baseDomain}_ecc`);
    return {
      certPath: path.join(certDir, 'fullchain.cer'),
      keyPath: path.join(certDir, `*.${baseDomain}.key`),
    };
  }

  /**
   * Returns true if the cert file exists and is valid for at least 30 more days.
   * openssl x509 -checkend returns 0 if cert is valid within the given seconds.
   */
  async isCertValid(certPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile(
        'openssl',
        ['x509', '-checkend', '2592000', '-noout', '-in', certPath],
        (err) => resolve(err === null),
      );
    });
  }

  private async ensureAcmeInstalled(log: (msg: string) => void): Promise<void> {
    const installed = await new Promise<boolean>((resolve) => {
      execFile('test', ['-x', ACME_BIN], (err) => resolve(err === null));
    });
    if (installed) return;

    log('acme.sh not found, installing...');
    await new Promise<void>((resolve, reject) => {
      execFile(
        'sh',
        ['-c', 'curl https://get.acme.sh | sh -s -- --no-cron'],
        (err, stdout, stderr) => {
          if (stdout) log(stdout.slice(-500));
          if (stderr) log(stderr.slice(-200));
          if (err) {
            reject(new Error(`acme.sh install failed: ${err.message}`));
            return;
          }
          log('acme.sh installed');
          resolve();
        },
      );
    });
  }

  private runAcme(
    args: string[],
    env: Record<string, string>,
    log: (msg: string) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        ACME_BIN,
        args,
        { env: { ...process.env, ...env } },
        (err, stdout, stderr) => {
          if (stdout) log(stdout.slice(-1000));
          if (stderr) log(stderr.slice(-500));
          // acme.sh exit code 2 = cert already valid and not yet due for renewal — treat as success
          const code = (err as { code?: number } | null)?.code;
          if (!err || code === 2) { resolve(); return; }
          reject(new Error(`acme.sh failed (exit ${code ?? 'unknown'}): ${err.message}`));
        },
      );
    });
  }
}
