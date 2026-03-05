/**
 * CertRenewalScheduler — daily job that renews expiring Let's Encrypt
 * wildcard certificates and pushes them to affected node servers.
 *
 * Only nodes with: transport=TCP, tls=TLS, source=AUTO, domain≠null
 * are managed here (those use real LE certs, not self-signed).
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { CertService } from '../common/cert/cert.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
import { NodeDeployService } from './node-deploy.service';

@Injectable()
export class CertRenewalScheduler {
  private readonly logger = new Logger(CertRenewalScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certService: CertService,
    private readonly cfSettings: CloudflareSettingsService,
    private readonly nodeDeploy: NodeDeployService,
  ) {}

  /** Run at 02:00 every day */
  @Cron('0 2 * * *')
  async renewExpiredCerts(): Promise<void> {
    this.logger.log('Starting daily cert renewal check...');

    // Find all TCP+TLS AUTO nodes that use LE certs
    const nodes = await this.prisma.node.findMany({
      where: {
        transport: 'TCP',
        tls: 'TLS',
        source: 'AUTO',
        domain: { not: null },
        enabled: true,
      },
      select: { id: true, userId: true, domain: true },
    });

    if (nodes.length === 0) {
      this.logger.log('No VLESS+TCP+TLS AUTO nodes found, skipping');
      return;
    }

    // Group by userId + baseDomain to avoid redundant renewals
    const renewed = new Set<string>(); // tracks which baseDomains were renewed this run

    for (const node of nodes) {
      const baseDomain = node.domain!.split('.').slice(1).join('.');
      const renewalKey = `${node.userId}:${baseDomain}`;

      try {
        const cf = await this.cfSettings.getDecryptedToken(node.userId);
        if (!cf) {
          this.logger.warn(`No CF settings for user ${node.userId}, skipping node ${node.id}`);
          continue;
        }

        const log = (msg: string) => this.logger.log(`[${node.id}] ${msg}`);

        // Only renew cert once per baseDomain per run
        if (!renewed.has(renewalKey)) {
          const didRenew = await this.certService.renewWildcardCert(cf.apiToken, baseDomain, log);
          if (didRenew) renewed.add(renewalKey);
        }

        // If cert was renewed, push to this node and restart
        if (renewed.has(renewalKey)) {
          this.logger.log(`Pushing renewed cert to node ${node.id}...`);
          await this.nodeDeploy.refreshCert(node.id);
          this.logger.log(`Node ${node.id} cert refreshed`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Cert renewal failed for node ${node.id}: ${msg}`);
        // Continue with remaining nodes — don't abort the entire run
      }
    }

    this.logger.log(`Cert renewal run complete. Renewed domains: ${[...renewed].join(', ') || 'none'}`);
  }
}
