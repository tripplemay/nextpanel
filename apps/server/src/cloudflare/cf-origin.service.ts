import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ResourceLifecycleService } from '../resources/resource-lifecycle.service';
import { withPostgresAdvisoryLocks } from '../common/database/advisory-lock';
import { CloudflareSettingsService } from './cloudflare-settings.service';
import { CfOriginApi } from './cf-origin-api';
import { originRoute, type OriginRoute } from './cf-origin.util';
import { verifyOriginFirewall } from './cf-origin-firewall';
import { ensureOriginNftables, preflightOriginHost } from './cf-origin-dependencies';
import { ensureCfXhttpCore, preflightCfXhttpCore } from '../nodes/protocols/cf-xhttp-core';

export const ORIGIN_AUDIT_BATCH = Prisma.sql`
  SELECT id FROM "Node"
  WHERE "publicPort" = 443 AND status = 'RUNNING' AND enabled = true
    AND "cfOriginRoute"->>'checkedAt' IS NOT NULL
  ORDER BY COALESCE("cfOriginRoute"->>'auditedAt', "cfOriginRoute"->>'checkedAt'), id
  LIMIT 20
`;

@Injectable()
export class CfOriginService {
  private readonly logger = new Logger(CfOriginService.name);
  private running = false;
  constructor(private prisma: PrismaService, private settings: CloudflareSettingsService, private resources: ResourceLifecycleService) {}

  private async api(ownerId: string, zoneId: string) {
    const cf = await this.settings.getDecryptedToken(ownerId);
    if (!cf) throw new Error('Cloudflare credentials unavailable');
    return new CfOriginApi(cf.apiToken, zoneId);
  }

  async preflight(ownerId: string, serverId: string, mapped: boolean) {
    const cf = await this.settings.getDecryptedToken(ownerId);
    if (!cf) throw new Error('Cloudflare credentials unavailable');
    if (mapped) await new CfOriginApi(cf.apiToken, cf.zoneId).preflight();
    const server = await this.prisma.server.findFirstOrThrow({ where: { id: serverId, userId: ownerId } });
    const ssh = await this.resources.connect(server);
    try {
      await this.resources.remoteHost(ssh, server.remoteHostId);
      await preflightCfXhttpCore(ssh);
      if (mapped) await preflightOriginHost(ssh);
    } finally { ssh.dispose(); }
  }

  async prepare(nodeId: string): Promise<OriginRoute> {
    const node = await this.prisma.node.findUniqueOrThrow({ where: { id: nodeId }, include: { server: true } });
    if (node.publicPort !== 443 || node.transport !== 'XHTTP' || node.tls !== 'TLS') {
      throw new Error('Invalid managed origin mapping');
    }
    let r: OriginRoute;
    if (node.cfOriginRoute) r = originRoute(node.cfOriginRoute);
    else {
      const cf = await this.settings.getDecryptedToken(node.userId);
      if (!cf) throw new Error('Cloudflare credentials unavailable');
      const instance = await this.resources.instanceId();
      r = { version: 1, zoneId: cf.zoneId, ref: `np_origin_${createHash('sha256').update(`${instance}:${node.id}`).digest('hex').slice(0, 32)}`,
        domain: node.domain ?? `np-${node.id}.${cf.domain}`.toLowerCase(), port: node.listenPort, state: 'PENDING' };
      originRoute(r);
    }
    if (r.port !== node.listenPort || (node.domain && r.domain !== node.domain)) throw new Error('Origin mapping identity changed');
    return withPostgresAdvisoryLocks([`nextpanel:cf-origin:${r.zoneId}`], async () => {
      try {
        const api = await this.api(node.userId, r.zoneId);
        await api.preflight(r);
        // Repeat host checks on retained intents too; a failed earlier attempt
        // is not proof that dependencies, ownership or the kernel still work.
        const ssh = await this.resources.connect(node.server, 300000);
        try {
          await this.resources.assertDeploymentOwner(ssh, node.server, node.id, 'ENTRY');
          await preflightOriginHost(ssh);
          await ensureOriginNftables(ssh, node.id, node.listenPort, r.ref);
          await ensureCfXhttpCore(ssh);
        } finally { ssh.dispose(); }
        // Persist intent before the first cloud write, including response loss.
        await this.prisma.node.update({ where: { id: nodeId }, data: { domain: r.domain, cfOriginRoute: { ...r } } });
        const recordId = await api.ensureDns(r, node.server.ip);
        await this.prisma.node.update({ where: { id: nodeId }, data: { cfDnsRecordId: recordId } });
        r = await api.ensureTls(r);
        await this.prisma.node.update({ where: { id: nodeId }, data: { cfOriginRoute: { ...r } } });
        await api.prerequisites(recordId, r.domain, node.server.ip, r.ref);
        const configured = { ...await api.ensure(r), state: 'CONFIGURED' as const, error: undefined };
        await this.prisma.node.update({ where: { id: nodeId }, data: { cfOriginRoute: configured } });
        return configured;
      } catch (e) {
        await this.fail(nodeId, r, e);
        throw e;
      }
    });
  }

  async ready(nodeId: string) {
    const node = await this.prisma.node.findUniqueOrThrow({ where: { id: nodeId }, include: { server: { select: { ip: true } } } });
    const r = originRoute(node.cfOriginRoute);
    if (node.publicPort !== 443 || node.domain !== r.domain || node.listenPort !== r.port) throw new Error('Origin mapping identity changed');
    const api = await this.api(node.userId, r.zoneId);
    await api.prerequisites(node.cfDnsRecordId!, r.domain, node.server.ip, r.ref);
    const verified = await api.verify(r);
    const now = new Date().toISOString();
    await this.prisma.node.update({ where: { id: nodeId }, data: {
      cfOriginRoute: { ...verified, state: 'READY', checkedAt: now, auditedAt: now, error: null },
    } });
  }

  private async fail(nodeId: string, r: OriginRoute, error: unknown) {
    const message = error instanceof Error ? error.message : 'Origin mapping verification failed';
    await this.prisma.node.updateMany({ where: { id: nodeId }, data: { cfOriginRoute: {
      ...r, state: 'ERROR', auditedAt: new Date().toISOString(), error: message.slice(0, 300),
    } } });
  }

  async remove(ownerId: string, value: unknown) {
    const r = originRoute(value);
    await withPostgresAdvisoryLocks([`nextpanel:cf-origin:${r.zoneId}`], async () => {
      const api = await this.api(ownerId, r.zoneId);
      await api.remove(r);
      await api.removeDns(r);
    });
  }

  async withdraw(nodeId: string, value: unknown) {
    const r = originRoute(value);
    // Clear acceptance before remote teardown; a partial deletion must not be
    // republished by the audit loop while waiting for the next cleanup attempt.
    await this.prisma.node.update({ where: { id: nodeId }, data: {
      cfOriginRoute: { ...r, state: 'CONFIGURED', checkedAt: null, error: 'Deletion started; redeploy required to publish again' },
    } });
  }

  @Cron('0 */5 * * * *')
  async audit() {
    if (this.running) return;
    this.running = true;
    try {
      // Heartbeats rewrite updatedAt; attempts (including failures) have their own
      // persisted ordering so neither active nor broken nodes starve other audits.
      const nodes = await this.prisma.$queryRaw<Array<{ id: string }>>(ORIGIN_AUDIT_BATCH);
      for (const candidate of nodes) {
        await withPostgresAdvisoryLocks([`nextpanel:node:${candidate.id}`], async () => {
          const node = await this.prisma.node.findUnique({ where: { id: candidate.id }, include: { server: true } });
          if (!node || node.status !== 'RUNNING' || !node.enabled) return;
          let r: OriginRoute;
          try { r = originRoute(node.cfOriginRoute); } catch { return; }
          // Only previously accepted deployments are eligible for read-only revalidation.
          if (!r.checkedAt) return;
          try {
            const ssh = await this.resources.connect(node.server);
            try {
              await this.resources.assertUnchangedDeployment(ssh, node.server, node.id);
              await verifyOriginFirewall(ssh, node.id, node.listenPort, r.ref);
            } finally { ssh.dispose(); }
            await this.ready(node.id);
          } catch (e) { await this.fail(node.id, r, e); }
        });
      }
    } catch { this.logger.warn('Origin audit incomplete; stale mappings fail closed'); }
    finally { this.running = false; }
  }
}
