/**
 * CertService — manages Let's Encrypt wildcard certificates on the panel server.
 *
 * Uses acme.sh with Cloudflare DNS-01 challenge to issue/renew *.{domain} certs.
 * Certs are stored locally and pushed to node servers via SFTP during deployment.
 */

import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { Injectable, Logger } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';

const ACME_HOME = path.join(os.homedir(), '.acme.sh');
const ACME_BIN = path.join(ACME_HOME, 'acme.sh');

export interface RemoteCertUpdate {
  readonly changed: boolean;
  /** Remove rollback files after the service has accepted the new pair. */
  commit(): Promise<void>;
  /** Restore the previous pair. Returns false when remote recovery is unverified. */
  rollback(): Promise<boolean>;
}

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
  ): Promise<RemoteCertUpdate> {
    const { certPath, keyPath } = this.getCertPaths(baseDomain);
    const remoteDir = '/etc/nextpanel/certs';
    const remoteCert = `${remoteDir}/${nodeId}.crt`;
    const remoteKey = `${remoteDir}/${nodeId}.key`;
    const operationId = crypto.randomUUID();
    const stagedCert = `${remoteCert}.next-${operationId}`;
    const stagedKey = `${remoteKey}.next-${operationId}`;
    const backupCert = `${remoteCert}.rollback-${operationId}`;
    const backupKey = `${remoteKey}.rollback-${operationId}`;
    let hadCert = false;
    let hadKey = false;
    let activationStarted = false;
    let state: 'pending' | 'committed' | 'rolled-back' = 'pending';

    const removeFiles = async (paths: string[]): Promise<void> => {
      try {
        const result = await ssh.execCommand(`rm -f -- ${paths.map(shellQuote).join(' ')}`);
        if (result.code !== 0) {
          log(`Remote TLS staging cleanup warning: ${remoteCommandDetail(result)}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Remote TLS staging cleanup warning: ${message}`);
      }
    };

    const requireSuccess = (
      result: { code: number | null; stdout?: string; stderr?: string },
      message: string,
    ): void => {
      if (result.code !== 0) {
        throw new Error(`${message}${remoteCommandDetail(result) ? `: ${remoteCommandDetail(result)}` : ''}`);
      }
    };

    const rollback = async (): Promise<boolean> => {
      if (state === 'rolled-back') return true;
      if (state === 'committed') return false;

      const restoreCert = hadCert
        ? `cp -p -- ${shellQuote(backupCert)} ${shellQuote(remoteCert)}`
        : `rm -f -- ${shellQuote(remoteCert)}`;
      const restoreKey = hadKey
        ? `cp -p -- ${shellQuote(backupKey)} ${shellQuote(remoteKey)}`
        : `rm -f -- ${shellQuote(remoteKey)}`;
      try {
        const restore = await ssh.execCommand(
          `failed=0; ${restoreCert} || failed=1; ${restoreKey} || failed=1; ` +
          `if [ -f ${shellQuote(remoteCert)} ]; then chown root:root ${shellQuote(remoteCert)} && chmod 0644 ${shellQuote(remoteCert)} || failed=1; fi; ` +
          `if [ -f ${shellQuote(remoteKey)} ]; then chown root:root ${shellQuote(remoteKey)} && chmod 0600 ${shellQuote(remoteKey)} || failed=1; fi; ` +
          `exit "$failed"`,
        );
        if (restore.code !== 0) {
          log(
            `TLS certificate rollback failed; backups retained at ${backupCert} and ${backupKey}` +
            `${remoteCommandDetail(restore) ? `: ${remoteCommandDetail(restore)}` : ''}`,
          );
          return false;
        }
        state = 'rolled-back';
        await removeFiles([backupCert, backupKey, stagedCert, stagedKey]);
        log(`Previous TLS certificate restored for ${nodeId}`);
        return true;
      } catch (restoreErr) {
        const restoreMessage = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
        log(
          `TLS certificate rollback failed; backups retained at ${backupCert} and ${backupKey}: ` +
          restoreMessage,
        );
        return false;
      }
    };

    log(`Pushing LE cert to node server...`);
    const mkdir = await ssh.execCommand(
      `mkdir -p -- ${shellQuote(remoteDir)} && chmod 0755 ${shellQuote(remoteDir)}`,
    );
    requireSuccess(mkdir, 'Failed to prepare remote TLS directory');

    try {
      await ssh.putFile(certPath, stagedCert, null, { mode: 0o644 });
      await ssh.putFile(keyPath, stagedKey, null, { mode: 0o600 });

      const stagedValidation = await ssh.execCommand(
        certificatePairValidationCommand(stagedCert, stagedKey),
      );
      requireSuccess(stagedValidation, 'Uploaded TLS certificate and private key do not form a valid pair');

      const unchanged = await ssh.execCommand(
        `test -f ${shellQuote(remoteCert)} && test -f ${shellQuote(remoteKey)} && ` +
        `cmp -s ${shellQuote(stagedCert)} ${shellQuote(remoteCert)} && ` +
        `cmp -s ${shellQuote(stagedKey)} ${shellQuote(remoteKey)}`,
      );
      if (unchanged.code === 0) {
        const permissions = await ssh.execCommand(
          `chown root:root ${shellQuote(remoteCert)} ${shellQuote(remoteKey)} && ` +
          `chmod 0644 ${shellQuote(remoteCert)} && chmod 0600 ${shellQuote(remoteKey)}`,
        );
        requireSuccess(permissions, 'Failed to secure current remote TLS private key');
        await removeFiles([stagedCert, stagedKey]);
        log(`LE cert already current at ${remoteCert}`);
        state = 'committed';
        return {
          changed: false,
          commit: async () => undefined,
          rollback: async () => true,
        };
      }

      const certProbe = await ssh.execCommand(`test -f ${shellQuote(remoteCert)}`);
      if (certProbe.code !== 0 && certProbe.code !== 1) {
        requireSuccess(certProbe, 'Failed to inspect existing remote TLS certificate');
      }
      hadCert = certProbe.code === 0;
      const keyProbe = await ssh.execCommand(`test -f ${shellQuote(remoteKey)}`);
      if (keyProbe.code !== 0 && keyProbe.code !== 1) {
        requireSuccess(keyProbe, 'Failed to inspect existing remote TLS private key');
      }
      hadKey = keyProbe.code === 0;

      if (hadCert) {
        const backup = await ssh.execCommand(
          `cp -p -- ${shellQuote(remoteCert)} ${shellQuote(backupCert)}`,
        );
        requireSuccess(backup, 'Failed to back up existing remote TLS certificate');
      }
      if (hadKey) {
        const backup = await ssh.execCommand(
          `cp -p -- ${shellQuote(remoteKey)} ${shellQuote(backupKey)}`,
        );
        requireSuccess(backup, 'Failed to back up existing remote TLS private key');
      }

      activationStarted = true;
      const activation = await ssh.execCommand(
        `failed=0; ` +
        `mv -f -- ${shellQuote(stagedCert)} ${shellQuote(remoteCert)} || failed=1; ` +
        `if [ "$failed" -eq 0 ]; then mv -f -- ${shellQuote(stagedKey)} ${shellQuote(remoteKey)} || failed=1; fi; ` +
        `if [ "$failed" -eq 0 ]; then ` +
        `chown root:root ${shellQuote(remoteCert)} ${shellQuote(remoteKey)} && ` +
        `chmod 0644 ${shellQuote(remoteCert)} && chmod 0600 ${shellQuote(remoteKey)} || failed=1; fi; ` +
        `exit "$failed"`,
      );
      requireSuccess(activation, 'Failed to atomically activate remote TLS certificate');

      const installedValidation = await ssh.execCommand(
        certificatePairValidationCommand(remoteCert, remoteKey),
      );
      requireSuccess(installedValidation, 'Activated remote TLS certificate failed validation');

      log(`LE cert activated at ${remoteCert}; retaining rollback pair until health check`);
      return {
        changed: true,
        commit: async () => {
          if (state !== 'pending') return;
          await removeFiles([backupCert, backupKey, stagedCert, stagedKey]);
          state = 'committed';
          log(`LE cert deployed to ${remoteCert}`);
        },
        rollback,
      };
    } catch (err) {
      if (activationStarted) {
        const restored = await rollback();
        if (!restored) {
          const message = err instanceof Error ? err.message : String(err);
          const rollbackError = new Error(
            `${message}; previous TLS certificate could not be restored`,
          ) as Error & { rollbackFailed: boolean };
          rollbackError.rollbackFailed = true;
          throw rollbackError;
        }
      } else {
        await removeFiles([backupCert, backupKey]);
      }
      await removeFiles([stagedCert, stagedKey]);
      throw err;
    }
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
      // Note: avoid passing --no-cron via `sh -s -- --no-cron` because the
      // double `--` causes get.acme.sh to forward `----no-cron` (4 dashes)
      // to the installer, which treats it as an unknown parameter and exits early.
      // The acme.sh cron job it installs is harmless — our NestJS scheduler
      // handles renewals independently.
      execFile(
        'sh',
        ['-c', 'curl https://get.acme.sh | sh'],
        (err, stdout, stderr) => {
          if (stdout) log(stdout.slice(-500));
          if (stderr) log(stderr.slice(-200));
          if (err) {
            reject(new Error(`acme.sh install failed: ${err.message}`));
            return;
          }
          // Verify binary actually exists — install can exit 0 with warnings
          execFile('test', ['-x', ACME_BIN], (testErr) => {
            if (testErr) {
              reject(new Error(`acme.sh install appeared to succeed but binary not found at ${ACME_BIN}`));
              return;
            }
            log('acme.sh installed');
            resolve();
          });
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function certificatePairValidationCommand(certPath: string, keyPath: string): string {
  return (
    `set -eu; ` +
    `openssl x509 -noout -in ${shellQuote(certPath)}; ` +
    `openssl pkey -noout -in ${shellQuote(keyPath)}; ` +
    `cert_public="$(openssl x509 -pubkey -noout -in ${shellQuote(certPath)} | ` +
    `openssl pkey -pubin -outform DER | openssl dgst -sha256)"; ` +
    `key_public="$(openssl pkey -in ${shellQuote(keyPath)} -pubout -outform DER | ` +
    `openssl dgst -sha256)"; ` +
    `test -n "$cert_public" && test "$cert_public" = "$key_public"`
  );
}

function remoteCommandDetail(result: { code: number | null; stdout?: string; stderr?: string }): string {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  return output || (result.code === null ? 'terminated without an exit code' : `exit ${result.code}`);
}
