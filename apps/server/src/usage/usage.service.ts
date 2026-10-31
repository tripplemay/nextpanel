import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { withPostgresAdvisoryLocks } from '../common/database/advisory-lock';
import type { NodeExportInfo } from '../subscriptions/uri-builder';
import { candidateKey, counterDelta, grantVersion, LEGACY_EMAIL, USAGE_ACTIVE_MS, USAGE_FRESH_MS, USAGE_LIMIT, usageEligible, usageEmail, usageStatus } from './usage.util';

export interface UsageGrant {
  subscriptionId: string; ownerId: string; subjectUserId: string; grantId: string; token: string;
}
export interface UsageSample {
  nodeId: string; sampleId: string; sampledAt: string; uptime: number;
  error?: 'UNAVAILABLE' | 'LIMIT';
  users: { email: string; upBytes: string; downBytes: string }[];
}

@Injectable()
export class UsageService {
  private readonly ingesting = new Set<string>();
  private readonly logger = new Logger(UsageService.name);
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}
  enabled() { return process.env.USAGE_OBSERVATION_ENABLED === 'true'; }

  enqueue(serverId: string, samples: UsageSample[]) {
    if (!this.enabled() || this.ingesting.has(serverId) || this.ingesting.size >= 8) return;
    this.ingesting.add(serverId);
    void this.ingest(serverId, samples)
      .catch(() => this.logger.warn(`Usage samples rejected for server ${serverId}`))
      .finally(() => this.ingesting.delete(serverId));
  }

  async setEnabled(id: string, ownerId: string, enabled: boolean) {
    if (enabled && !this.enabled()) throw new ServiceUnavailableException('Usage observation is disabled by the administrator');
    const sub = await this.prisma.subscription.findFirst({ where: { id, ownerId }, include: { nodes: { include: { node: true } } } });
    if (!sub) throw new NotFoundException();
    const nodes = sub.nodes.map(n => n.node).filter(n => n.userId === ownerId && usageEligible(n)
      && (sub.cfOnly || sub.cfProtectedNodeIds.includes(n.id)));
    if (enabled && !nodes.length) throw new BadRequestException('No protected VLESS WS TLS nodes available');
    const recorded = await this.prisma.usageCredential.findMany({ where: { subscriptionId: id, ownerId }, select: { nodeId: true }, distinct: ['nodeId'] });
    // A queued sample must not restore the old baseline after a pause has committed.
    await withPostgresAdvisoryLocks([...sub.nodes.map(n => n.nodeId), ...recorded.map(r => r.nodeId)]
      .map(nodeId => `nextpanel:usage-sample:${nodeId}`), () => this.prisma.$transaction([
      this.prisma.subscription.update({ where: { id }, data: { usageEnabled: enabled } }),
      ...(sub.usageEnabled !== enabled ? [this.prisma.usageCredential.updateMany({ where: { subscriptionId: id, ownerId },
        data: { sampledAt: null, lastActiveAt: null, upRate: null, downRate: null } })] : []),
      ...nodes.map(n => this.prisma.usageNode.upsert({ where: { nodeId: n.id }, create: { nodeId: n.id }, update: {} })),
    ]));
    return { id, enabled };
  }

  async decorate(nodeId: string, grant: UsageGrant, variants: NodeExportInfo[]) {
    if (!this.enabled()) return variants;
    return withPostgresAdvisoryLocks([`nextpanel:usage:${nodeId}`], async () => {
      const node = await this.prisma.node.findFirst({ where: { id: nodeId, userId: grant.ownerId }, include: { usageState: true } });
      if (!node || !usageEligible(node)) return variants;
      const version = grantVersion(grant.token);
      const result: NodeExportInfo[] = [];
      for (const variant of variants) {
        const key = candidateKey(variant);
        let credential = await this.prisma.usageCredential.findUnique({ where: { nodeId_grantVersion_candidateKey: { nodeId, grantVersion: version, candidateKey: key } } });
        if (!credential || credential.revokedAt) {
          const count = await this.prisma.usageCredential.count({ where: { nodeId, removedAt: null } });
          if (count >= USAGE_LIMIT) {
            await this.prisma.usageNode.update({ where: { nodeId }, data: { error: 'CREDENTIAL_LIMIT' } });
            result.push(variant);
            continue;
          }
          const revokedId = credential?.id;
          credential = await this.prisma.$transaction(async tx => {
            // Preserve the old UUID and its revocation/history while freeing the active lookup key.
            if (revokedId) await tx.usageCredential.update({ where: { id: revokedId }, data: { candidateKey: `revoked:${revokedId}:${key}` } });
            return tx.usageCredential.create({ data: {
              nodeId, ownerId: grant.ownerId, subscriptionId: grant.subscriptionId, subjectUserId: grant.subjectUserId,
              grantId: grant.grantId, grantVersion: version, candidateKey: key,
              candidateIp: variant.host, carrier: variant.cfCarrier ?? 'MANUAL', label: variant.name,
              uuidEnc: this.crypto.encrypt(randomUUID()),
            } });
          });
        }
        // A failed preparation never replaces a working CDN credential with an unusable one.
        if (node.usageState?.preparedAt && credential.installedAt && !credential.revokedAt) {
          result.push({ ...variant, credentials: { ...variant.credentials, uuid: this.crypto.decrypt(credential.uuidEnc) } });
          if (Date.now() - credential.lastExportedAt.getTime() > 60_000) await this.prisma.usageCredential.update({ where: { id: credential.id }, data: { lastExportedAt: new Date() } });
        } else result.push(variant);
      }
      return result;
    });
  }

  async revokeInvalidGrants(nodeId: string) {
    const rows = await this.prisma.usageCredential.findMany({ where: { nodeId, revokedAt: null } });
    const subs = await this.prisma.subscription.findMany({ where: { id: { in: [...new Set(rows.map(r => r.subscriptionId))] } },
      include: { shares: true, nodes: { select: { nodeId: true } } } });
    const invalid = rows.filter(row => {
      const sub = subs.find(s => s.id === row.subscriptionId && s.ownerId === row.ownerId);
      if (!sub || !sub.nodes.some(n => n.nodeId === nodeId)) return true;
      if (row.grantId === 'owner') return grantVersion(sub.token) !== row.grantVersion || sub.ownerId !== row.subjectUserId;
      const share = sub.shares.find(s => s.id === row.grantId && s.userId === row.subjectUserId);
      return !share || grantVersion(share.shareToken) !== row.grantVersion;
    });
    if (invalid.length) await this.prisma.usageCredential.updateMany({ where: { id: { in: invalid.map(r => r.id) } }, data: { revokedAt: new Date() } });
  }

  async ingest(serverId: string, samples: UsageSample[]) {
    if (!this.enabled()) return;
    for (const sample of samples) {
      const at = new Date(sample.sampledAt);
      if (!Number.isFinite(at.getTime()) || Math.abs(Date.now() - at.getTime()) > USAGE_FRESH_MS) continue;
      await withPostgresAdvisoryLocks([`nextpanel:usage-sample:${sample.nodeId}`], async () => {
        const state = await this.prisma.usageNode.findFirst({ where: { nodeId: sample.nodeId, node: { serverId } } });
        if (!state || !state.preparedAt || state.sampleId === sample.sampleId || (state.sampledAt && at <= state.sampledAt)) return;
        if (sample.error) return; // Do not refresh a successful sample's timestamp on failure.
        const records = await this.prisma.usageCredential.findMany({ where: { nodeId: sample.nodeId, installedAt: { not: null }, removedAt: null } });
        const enabledSubs = new Set((await this.prisma.subscription.findMany({ where: { id: { in: records.map(r => r.subscriptionId) }, usageEnabled: true }, select: { id: true } })).map(s => s.id));
        const seconds = state.sampledAt ? (at.getTime() - state.sampledAt.getTime()) / 1000 : 0;
        const reset = state.coreUptime === null || BigInt(sample.uptime) < state.coreUptime
          || Math.abs(Number(BigInt(sample.uptime) - state.coreUptime) - seconds) > 3;
        const stats = new Map(sample.users.map(u => [u.email, u]));
        if (stats.size !== sample.users.length) return;
        const bucket = new Date(Math.floor(at.getTime() / 3600_000) * 3600_000);
        await this.prisma.$transaction(async tx => {
          for (const row of records) {
            if (!enabledSubs.has(row.subscriptionId)) continue;
            const stat = stats.get(usageEmail(row.id)) ?? { upBytes: '0', downBytes: '0' };
            const up = BigInt(stat.upBytes); const down = BigInt(stat.downBytes);
            const baseline = reset || !row.sampledAt || row.sampledAt.getTime() !== state.sampledAt?.getTime();
            const u = counterDelta(up, row.upBytes, seconds, baseline); const d = counterDelta(down, row.downBytes, seconds, baseline);
            await tx.usageCredential.update({ where: { id: row.id }, data: { sampledAt: at, upBytes: up, downBytes: down,
              upRate: u.rate, downRate: d.rate, ...((u.bytes > 0n || d.bytes > 0n) ? { lastActiveAt: at } : {}) } });
            if (u.bytes > 0n || d.bytes > 0n) await tx.usageBucket.upsert({ where: { credentialId_timestamp: { credentialId: row.id, timestamp: bucket } },
              create: { credentialId: row.id, timestamp: bucket, upBytes: u.bytes, downBytes: d.bytes },
              update: { upBytes: { increment: u.bytes }, downBytes: { increment: d.bytes } } });
          }
          const legacy = stats.get(LEGACY_EMAIL);
          const u = counterDelta(BigInt(legacy?.upBytes ?? '0'), state.legacyUp, seconds, reset);
          const d = counterDelta(BigInt(legacy?.downBytes ?? '0'), state.legacyDown, seconds, reset);
          await tx.usageNode.update({ where: { nodeId: sample.nodeId }, data: { sampledAt: at, sampleId: sample.sampleId, coreUptime: BigInt(sample.uptime),
            ...(legacy ? { legacyUp: BigInt(legacy.upBytes), legacyDown: BigInt(legacy.downBytes), legacyUpRate: u.rate ?? 0, legacyDownRate: d.rate ?? 0,
              ...((u.bytes > 0n || d.bytes > 0n) ? { legacyActiveAt: at } : {}) } : { legacyUpRate: 0, legacyDownRate: 0 }) } });
        });
      });
    }
  }

  async overview(ownerId: string, subscriptionId?: string) {
    const now = Date.now();
    const subscriptions = await this.prisma.subscription.findMany({ where: { ownerId, ...(subscriptionId ? { id: subscriptionId } : {}) },
      include: { nodes: { include: { node: { include: { usageState: true, server: { select: { agentVersion: true, lastSeenAt: true } } } } } }, _count: { select: { externalNodes: true } } }, orderBy: { name: 'asc' } });
    if (subscriptionId && !subscriptions.length) throw new NotFoundException();
    const subs = new Map(subscriptions.map(s => [s.id, s]));
    const records = await this.prisma.usageCredential.findMany({ where: { ownerId, subscriptionId: { in: [...subs.keys()] }, removedAt: null },
      include: { node: { select: { name: true, usageState: true } } }, orderBy: [{ lastActiveAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }], take: 1001 });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(records.map(r => r.subjectUserId))] } }, select: { id: true, username: true } })).map(u => [u.id, u.username]));
    const rows = records.slice(0, 1000).map(r => {
      const status = !this.enabled() || !subs.get(r.subscriptionId)?.usageEnabled ? 'PAUSED' : r.revokedAt ? 'REVOKING'
        : usageStatus(r.sampledAt, r.lastActiveAt, !!r.installedAt, now);
      const fresh = status === 'ACTIVE' || status === 'IDLE';
      return { id: r.id, subscriptionId: r.subscriptionId, subscriptionName: subs.get(r.subscriptionId)!.name,
        subjectId: r.subjectUserId, subjectName: users.get(r.subjectUserId) ?? '已删除用户', grantKind: r.grantId === 'owner' ? 'OWNER' : 'SHARE',
        nodeId: r.nodeId, nodeName: r.node.name, candidateIp: r.candidateIp, carrier: r.carrier, label: r.label,
        status, sampledAt: r.sampledAt, lastActiveAt: r.lastActiveAt, installedAt: r.installedAt,
        upRate: fresh ? r.upRate : null, downRate: fresh ? r.downRate : null,
        evidence: 'SERVER_CREDENTIAL', actualEdgeIp: null };
    });
    const nodes = [...new Map(subscriptions.flatMap(s => s.nodes.map(n => n.node)).filter(n => n.userId === ownerId).map(n => [n.id, n])).values()];
    const coverage = nodes.map(n => ({ id: n.id, name: n.name,
      serverId: n.serverId, agentVersion: n.server.agentVersion, agentSeenAt: n.server.lastSeenAt,
      eligible: usageEligible(n) && subscriptions.some(s => s.nodes.some(sn => sn.nodeId === n.id) && (s.cfOnly || s.cfProtectedNodeIds.includes(n.id))),
      observing: subscriptions.some(s => s.usageEnabled && s.nodes.some(sn => sn.nodeId === n.id)),
      preparedAt: n.usageState?.preparedAt ?? null, syncedAt: n.usageState?.syncedAt ?? null,
      error: n.usageState?.error ?? null, sampledAt: n.usageState?.sampledAt ?? null,
      legacyActiveAt: n.usageState?.legacyActiveAt ?? null,
      fresh: this.enabled() && subscriptions.some(s => s.usageEnabled && s.nodes.some(sn => sn.nodeId === n.id))
        && !!n.usageState?.sampledAt && now - n.usageState.sampledAt.getTime() <= USAGE_FRESH_MS,
    }));
    return { enabled: this.enabled(), asOf: new Date(now), freshnessSeconds: USAGE_FRESH_MS / 1000, activeWindowSeconds: USAGE_ACTIVE_MS / 1000,
      limited: records.length > 1000, rows, nodes: coverage,
      subscriptions: subscriptions.map(s => ({ id: s.id, name: s.name, enabled: s.usageEnabled, externalCount: s._count.externalNodes,
        automatic: s.cfAuto, protectedCount: s.nodes.filter(n => n.node.userId === ownerId && usageEligible(n.node) && (s.cfOnly || s.cfProtectedNodeIds.includes(n.nodeId))).length })),
      summary: { activeSubjects: new Set(rows.filter(r => r.status === 'ACTIVE').map(r => r.subjectId)).size,
        activeCandidates: rows.filter(r => r.status === 'ACTIVE').length,
        preparedNodes: coverage.filter(n => n.preparedAt).length, freshNodes: coverage.filter(n => n.fresh).length,
        legacyActiveNodes: coverage.filter(n => n.fresh && n.legacyActiveAt && now - n.legacyActiveAt.getTime() <= USAGE_ACTIVE_MS).length } };
  }

  async history(id: string, ownerId: string) {
    const row = await this.prisma.usageCredential.findFirst({ where: { id, ownerId } });
    if (!row || !await this.prisma.subscription.count({ where: { id: row.subscriptionId, ownerId } })) throw new NotFoundException();
    return (await this.prisma.usageBucket.findMany({ where: { credentialId: id, timestamp: { gte: new Date(Date.now() - 7 * 86400_000) } }, orderBy: { timestamp: 'asc' }, take: 169 }))
      .map(b => ({ timestamp: b.timestamp, upBytes: b.upBytes.toString(), downBytes: b.downBytes.toString() }));
  }
}
