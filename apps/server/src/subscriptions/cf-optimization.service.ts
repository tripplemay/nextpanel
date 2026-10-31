import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { NodesService } from '../nodes/nodes.service';
import { CfAccessService } from './cf-access.service';
import { CF_IP_RANGES, assertCfManagedNode } from './cf-access.util';
import { withPostgresAdvisoryLocks } from '../common/database/advisory-lock';
import { allowedByRanges, automaticVariants, CARRIERS, CfMeasurement, CfObservation, CfProbe,
  discoverCandidates, fingerprint, FRESH_MS, probeRegistry, rangeList, rankCandidates, STALE_MS, updateObservations } from './cf-optimization.util';
import type { NodeExportInfo } from './uri-builder';

export function nodeFingerprint(node: Record<string, unknown>): string {
  return fingerprint(['userId', 'serverId', 'cfDnsRecordId', 'domain', 'listenPort', 'protocol', 'transport', 'tls', 'credentialsEnc', 'exitType',
    'exitServerId', 'exitPort', 'chainCredEnc', 'socksExitEnc'].map(key => node[key] ?? null));
}

export async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.ok || !response.body) throw new Error('REMOTE_UNAVAILABLE');
  const reader = response.body.getReader();
  let text = ''; let bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('REMOTE_RESPONSE_TOO_LARGE');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}

@Injectable()
export class CfOptimizationService {
  private readonly logger = new Logger(CfOptimizationService.name);
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly nodes: NodesService, private readonly cf: CfAccessService) {}

  private probes(): CfProbe[] { return probeRegistry(process.env.CF_OPTIMIZATION_PROBES); }
  private probeFingerprint(probe: CfProbe): string {
    return fingerprint([probe, fingerprint(process.env[probe.tokenEnv] ?? '')]);
  }
  private rowFingerprint(node: Record<string, unknown>, probe: CfProbe): string {
    return fingerprint([nodeFingerprint(node), this.probeFingerprint(probe)]);
  }

  private monthlyLimit(): number | null {
    const raw = process.env.CF_OPTIMIZATION_MAX_MONTHLY_BATCHES
      ?? (process.env.CF_OPTIMIZATION_LOW_BUDGET === 'true' ? '200' : undefined);
    if (raw === undefined) return null;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 1_000_000) {
      throw new Error('INVALID_MONTHLY_BUDGET');
    }
    return Number(raw);
  }

  private async reserveMonthlyBatch(now: number, limit: number): Promise<boolean> {
    // Independent lock also protects bounded manual validation and multiple panel replicas.
    return withPostgresAdvisoryLocks(['cf-optimization-monthly-budget'], async () => {
      const key = `monthly:${new Date(now).toISOString().slice(0, 7)}`;
      const row = await this.prisma.cfOptimizationState.findUnique({ where: { key } });
      const used = (row?.value as { batches?: number } | undefined)?.batches ?? 0;
      if (!Number.isSafeInteger(used) || used < 0) throw new Error('INVALID_MONTHLY_USAGE');
      if (used >= limit) return false;
      const value = { batches: used + 1 };
      await this.prisma.cfOptimizationState.upsert({ where: { key }, create: { key, value }, update: { value } });
      return true;
    }, { lockWaitMs: 1000 });
  }

  async ranges(): Promise<string[]> {
    const row = await this.prisma.cfOptimizationState.findUnique({ where: { key: 'ranges' } });
    const value = row?.value as { cidrs?: string[] } | undefined;
    return value?.cidrs ?? CF_IP_RANGES;
  }

  async syncRanges(now: number): Promise<void> {
    const row = await this.prisma.cfOptimizationState.findUnique({ where: { key: 'ranges' } });
    if (row && now - row.updatedAt.getTime() < 86400_000) return;
    try {
      const v4 = rangeList(await boundedText(await fetch('https://www.cloudflare.com/ips-v4',
        { redirect: 'error', signal: AbortSignal.timeout(10_000) }), 16384), 4);
      const v6 = rangeList(await boundedText(await fetch('https://www.cloudflare.com/ips-v6',
        { redirect: 'error', signal: AbortSignal.timeout(10_000) }), 16384), 6);
      const value = { cidrs: [...v4, ...v6], fetchedAt: now };
      await this.prisma.cfOptimizationState.upsert({ where: { key: 'ranges' }, create: { key: 'ranges', value }, update: { value } });
      await this.prisma.cfOptimizationState.deleteMany({ where: { key: 'ranges-error' } });
    } catch {
      const value = { at: now, error: 'OFFICIAL_RANGES_UNAVAILABLE_OR_REVIEW_REQUIRED' };
      await this.prisma.cfOptimizationState.upsert({ where: { key: 'ranges-error' }, create: { key: 'ranges-error', value }, update: { value } });
    }
  }

  async variants(exported: NodeExportInfo, node: Record<string, unknown> & { id: string }, defaultIp: string | null) {
    const ranges = await this.ranges();
    const now = Date.now();
    const rows = await this.prisma.cfOptimization.findMany({ where: { nodeId: node.id } });
    let probes: CfProbe[] = [];
    try { probes = this.probes(); } catch { /* Invalid registry must not publish attributed rankings. */ }
    const profiles = CARRIERS.map(carrier => {
      const entries = rows.flatMap(row => {
        const probe = probes.find(p => p.id === row.probeId);
        if (!probe || row.fingerprint !== this.rowFingerprint(node, probe)) return [];
        const age = now - row.checkedAt.getTime();
        const label = age <= FRESH_MS ? row.carrier : 'GENERIC';
        if (age > STALE_MS || label !== carrier) return [];
        return (row.published as unknown as CfObservation[]).filter(o => allowedByRanges(o.ip, ranges)
          && now - o.checkedAt <= STALE_MS && o.failed < 2);
      });
      // Do not multiply a carrier's aliases by its number of regional probes.
      return { carrier, ips: [...new Set(entries.sort((a, b) => a.latency - b.latency).map(o => o.ip))].slice(0, 3) };
    }).filter(p => p.ips.length);
    return automaticVariants(exported, node.id, profiles, defaultIp && allowedByRanges(defaultIp, ranges) ? defaultIp : null);
  }

  async status(nodeId: string, userId: string) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, userId } });
    if (!node) throw new NotFoundException('Node not found');
    const rows = await this.prisma.cfOptimization.findMany({ where: { nodeId } });
    const ranges = await this.prisma.cfOptimizationState.findUnique({ where: { key: 'ranges' } });
    const rangeError = await this.prisma.cfOptimizationState.findUnique({ where: { key: 'ranges-error' } });
    const paused = !!await this.prisma.cfOptimizationState.findUnique({ where: { key: `pause:${nodeId}` } });
    let monthlyLimit: number | null = null; let budgetError = false;
    try { monthlyLimit = this.monthlyLimit(); } catch { budgetError = true; }
    let probes: CfProbe[] = []; let registryError = false;
    try { probes = this.probes(); } catch { registryError = true; }
    return {
      enabled: process.env.CF_OPTIMIZATION_ENABLED === 'true', paused, registryError,
      budget: { lowBudget: process.env.CF_OPTIMIZATION_LOW_BUDGET === 'true', monthlyLimit, error: budgetError },
      rangeUpdatedAt: ranges?.updatedAt ?? null, rangeError: !!rangeError,
      profiles: probes.map(p => {
        const row = rows.find(r => r.probeId === p.id && r.fingerprint === this.rowFingerprint(node, p));
        return { probeId: p.id, carrier: p.carrier, region: p.region, checkedAt: row?.checkedAt ?? null,
          stale: !row || Date.now() - row.checkedAt.getTime() > FRESH_MS,
          error: row?.error ?? null, revision: row?.revision ?? 0,
          candidates: row?.published ?? [], observations: row?.observations ?? [] };
      }),
      missingCarriers: CARRIERS.filter(c => c !== 'GENERIC' && !rows.some(r => r.carrier === c
        && probes.some(p => p.id === r.probeId && r.fingerprint === this.rowFingerprint(node, p))
        && Date.now() - r.checkedAt.getTime() <= FRESH_MS && Array.isArray(r.published) && r.published.length)),
    };
  }

  async rollback(nodeId: string, userId: string) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, userId } });
    if (!node) throw new NotFoundException('Node not found');
    return withPostgresAdvisoryLocks(['cf-optimization'], async () => {
      const ranges = await this.ranges(); const probes = this.probes();
      const rows = await this.prisma.cfOptimization.findMany({ where: { nodeId } });
      const updates = rows.filter(r => probes.some(p => p.id === r.probeId && r.fingerprint === this.rowFingerprint(node, p)))
        .map(row => ({ row, prior: (row.previous as unknown as CfObservation[]).filter(o => Date.now() - o.checkedAt <= STALE_MS
          && allowedByRanges(o.ip, ranges) && !(row.observations as unknown as CfObservation[]).some(n => n.ip === o.ip && n.failed >= 2)) }));
      if (!updates.some(u => u.prior.length)) throw new BadRequestException('No safe previous CF snapshot available');
      // Freeze this node's optimization until an explicit resume; exports still enforce age and CF membership.
      await this.prisma.$transaction([
        ...updates.map(({ row, prior }) => this.prisma.cfOptimization.update({ where: { id: row.id },
          data: { published: JSON.parse(JSON.stringify(prior)), previous: row.published!, revision: { increment: 1 } } })),
        this.prisma.cfOptimizationState.upsert({ where: { key: `pause:${nodeId}` },
          create: { key: `pause:${nodeId}`, value: true }, update: { value: true } }),
      ]);
      return { rolledBack: true, paused: true };
    }, { lockWaitMs: 1000 });
  }

  async resume(nodeId: string, userId: string) {
    if (!await this.prisma.node.findFirst({ where: { id: nodeId, userId }, select: { id: true } })) throw new NotFoundException('Node not found');
    await withPostgresAdvisoryLocks(['cf-optimization'], async () => {
      await this.prisma.cfOptimizationState.deleteMany({ where: { key: `pause:${nodeId}` } });
    }, { lockWaitMs: 1000 });
    return { paused: false };
  }

  @Cron('0 */5 * * * *')
  async tick(): Promise<void> {
    if (this.running || process.env.CF_OPTIMIZATION_ENABLED !== 'true') return;
    const time = new Date(Date.now());
    const lowBudget = process.env.CF_OPTIMIZATION_LOW_BUDGET === 'true';
    if (lowBudget && (time.getUTCHours() % 8 !== 0 || time.getUTCMinutes() >= 10)) return;
    this.running = true;
    try {
      await withPostgresAdvisoryLocks(['cf-optimization'], async () => {
        const probes = this.probes();
        if (!probes.length) return;
        const started = Date.now();
        await this.syncRanges(started);
        const nodes = await this.prisma.node.findMany({ where: { enabled: true, status: 'RUNNING',
          subscriptionNodes: { some: { subscription: { cfOnly: true, cfAuto: true } } } } });
        const previous = await this.prisma.cfOptimization.findMany({ where: { nodeId: { in: nodes.map(n => n.id) } } });
        const jobs = nodes.flatMap(node => probes.map(probe => ({ node, probe,
          last: previous.find(r => r.nodeId === node.id && r.probeId === probe.id)?.attemptedAt.getTime() ?? 0 })))
          .sort((a, b) => a.last - b.last);
        for (const job of jobs) {
          if (Date.now() - started > 180_000) break;
          // Deduplicate paired rounds by slot, not elapsed time since a queued job started.
          const alreadyAttempted = lowBudget ? Math.floor(job.last / 300_000) >= Math.floor(started / 300_000)
            : started - job.last < 240_000;
          if (alreadyAttempted || await this.prisma.cfOptimizationState.findUnique({ where: { key: `pause:${job.node.id}` } })) continue;
          const retry = (await this.prisma.cfOptimizationState.findUnique({ where: { key: `retry:${job.node.id}:${job.probe.id}` } }))?.value as { nextAt?: number } | undefined;
          if ((retry?.nextAt ?? 0) > started) continue;
          await this.measure(job.node, job.probe);
        }
        await this.prisma.cfOptimizationState.deleteMany({ where: { key: { startsWith: 'budget:' }, updatedAt: { lt: new Date(started - 7 * 86400_000) } } });
      }, { lockWaitMs: 1 });
    } catch {
      // Do not log remote URLs, credentials, request bodies or arbitrary remote errors.
      this.logger.warn('CF optimization cycle deferred; check registry, lock and database health');
    } finally { this.running = false; }
  }

  async measure(node: Awaited<ReturnType<PrismaService['node']['findFirstOrThrow']>>, probe: CfProbe): Promise<void> {
    const now = Date.now(); const identity = this.rowFingerprint(node, probe);
    const existing = await this.prisma.cfOptimization.findUnique({ where: { nodeId_probeId: { nodeId: node.id, probeId: probe.id } } });
    const old = existing?.fingerprint === identity ? existing : null;
    const observed = (old?.observations ?? []) as unknown as CfObservation[];
    const published = (old?.published ?? []) as unknown as CfObservation[];
    let phase = 'PROBE_UNAVAILABLE';
    try {
      assertCfManagedNode(node);
      const token = process.env[probe.tokenEnv];
      if (!token || token.length < 32) throw new Error('Missing authenticated probe');
      phase = 'INVALID_MONTHLY_BUDGET';
      const monthlyLimit = this.monthlyLimit();
      phase = 'MONTHLY_BUDGET_UNAVAILABLE';
      if (monthlyLimit !== null && !await this.reserveMonthlyBatch(now, monthlyLimit)) {
        phase = 'MONTHLY_BUDGET_EXHAUSTED';
        throw new Error('Monthly budget exhausted');
      }
      // Count before even /capabilities: failed/auth-rejected cloud calls still incur costs.
      phase = 'PROBE_UNAVAILABLE';
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const capabilities = JSON.parse(await boundedText(await fetch(`${probe.url.replace(/\/$/, '')}/capabilities`,
        { headers, redirect: 'error', signal: AbortSignal.timeout(10_000) }), 8192));
      phase = 'PROBE_IDENTITY_OR_CAPABILITY_MISMATCH';
      if (capabilities.protocol !== 2 || capabilities.probeId !== probe.id || !capabilities.features?.includes('vless-ws-tls')
        || (probe.carrier !== 'GENERIC' && capabilities.egressIp !== probe.expectedEgressIp)) throw new Error('Probe mismatch');
      const ranges = await this.ranges(); const dns = await this.cf.defaultIp(node.domain!);
      const discoveryDue = !old || now - old.discoveredAt.getTime() >= 6 * 3600_000;
      const pool = discoveryDue ? discoverCandidates(ranges, `${probe.id}:${node.id}:${Math.floor(now / (6 * 3600_000))}`,
        dns ? [dns] : [], published.map(o => o.ip)) : observed.map(o => o.ip);
      // Prioritize incumbents, then untested/probation candidates; failed addresses cool down for six hours.
      const probation = (ip: string) => observed.some(o => o.ip === ip && o.passed === 1 && now - o.checkedAt <= FRESH_MS) ? 0 : 1;
      const ips = [...new Set([...published.map(o => o.ip), ...pool.sort((a, b) => probation(a) - probation(b)
        || (observed.find(o => o.ip === a)?.checkedAt ?? 0) - (observed.find(o => o.ip === b)?.checkedAt ?? 0))])]
        .filter(ip => allowedByRanges(ip, ranges) && !observed.some(o => o.ip === ip && o.failed >= 2 && now - o.checkedAt < 6 * 3600_000)).slice(0, 8);
      if (!ips.length) throw new Error('No candidates');
      const key = `budget:${probe.id}:${new Date(now).toISOString().slice(0, 10)}`;
      const budget = (await this.prisma.cfOptimizationState.findUnique({ where: { key } }))?.value as { requests?: number; bytes?: number } | undefined;
      const availableDownloads = Math.max(0, Math.min(3, Math.floor((100 * 1024 * 1024 - (budget?.bytes ?? 0)) / (1024 * 1024))));
      const downloadIps = observed.filter(o => o.passed >= 2 && !o.failed && ips.includes(o.ip) && now - (o.bandwidthAt ?? 0) >= 6 * 3600_000)
        .sort((a, b) => (a.bandwidthAt ?? 0) - (b.bandwidthAt ?? 0)).map(o => o.ip).slice(0, availableDownloads);
      const requests = (budget?.requests ?? 0) + ips.length;
      const downloadBytes = (budget?.bytes ?? 0) + downloadIps.length * 1024 * 1024;
      phase = 'DAILY_BUDGET_EXHAUSTED';
      if (requests > 5000) throw new Error('Budget exhausted');
      const value = { requests, bytes: downloadBytes };
      await this.prisma.cfOptimizationState.upsert({ where: { key }, create: { key, value }, update: { value } });
      const credentials = await this.nodes.getCredentials(node.id, node.userId);
      phase = 'PROBE_UNAVAILABLE';
      const batch = JSON.parse(await boundedText(await fetch(`${probe.url.replace(/\/$/, '')}/probe`, { method: 'POST', headers,
        redirect: 'error', signal: AbortSignal.timeout(90_000), body: JSON.stringify({ ips, domain: node.domain,
          uuid: credentials.uuid, path: credentials.path || '/', downloadIps }) }), 32768));
      phase = 'INVALID_PROBE_RESULT';
      if (batch.protocol !== 2 || batch.probeId !== probe.id || (probe.carrier !== 'GENERIC' && batch.egressIp !== probe.expectedEgressIp)
        || !Array.isArray(batch.results) || batch.results.length !== ips.length) throw new Error('Invalid batch');
      const results = batch.results as CfMeasurement[];
      if (new Set(results.map(r => r.ip)).size !== ips.length || results.some(r => !ips.includes(r.ip) || typeof r.ok !== 'boolean'
        || !Number.isFinite(r.latency) || (r.bytes !== undefined && (!downloadIps.includes(r.ip) || !Number.isFinite(r.bytes)
          || r.bytes !== 1024 * 1024 || !Number.isFinite(r.durationMs) || r.durationMs! <= 0 || r.durationMs! > 20_000)))) throw new Error('Invalid measurements');
      const observations = updateObservations(observed, results, now);
      // Keep yet-unprobed discoveries in the bounded queue for subsequent rounds.
      for (const ip of pool) if (!observations.some(o => o.ip === ip)) observations.push({ ip, passed: 0, failed: 0, latency: 60_000, checkedAt: 0 });
      const next = rankCandidates(observations, published, now);
      const changed = fingerprint(next.map(o => o.ip)) !== fingerprint(published.map(o => o.ip));
      // Configuration changes/deletion during a probe invalidate its outcome.
      const current = await this.prisma.node.findUnique({ where: { id: node.id } });
      if (!current || nodeFingerprint(current) !== nodeFingerprint(node) || !current.enabled || current.status !== 'RUNNING') return;
      const data = { fingerprint: identity, carrier: probe.carrier, region: probe.region,
        observations: JSON.parse(JSON.stringify(observations.slice(0, 64))), published: JSON.parse(JSON.stringify(next)),
        previous: changed ? JSON.parse(JSON.stringify(published)) : (old?.previous ?? []),
        checkedAt: new Date(now), attemptedAt: new Date(now), discoveredAt: discoveryDue ? new Date(now) : old!.discoveredAt, error: null,
        revision: (old?.revision ?? 0) + (changed ? 1 : 0) };
      await this.prisma.cfOptimization.upsert({ where: { nodeId_probeId: { nodeId: node.id, probeId: probe.id } },
        create: { nodeId: node.id, probeId: probe.id, ...data }, update: data });
      await this.prisma.cfOptimizationState.deleteMany({ where: { key: `retry:${node.id}:${probe.id}` } });
    } catch {
      const key = `retry:${node.id}:${probe.id}`;
      const retry = (await this.prisma.cfOptimizationState.findUnique({ where: { key } }))?.value as { failures?: number } | undefined;
      const failures = Math.min(8, (retry?.failures ?? 0) + 1);
      const nextAt = phase === 'DAILY_BUDGET_EXHAUSTED' ? (Math.floor(now / 86400_000) + 1) * 86400_000
        : phase === 'MONTHLY_BUDGET_EXHAUSTED' ? Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1)
        : now + Math.min(3600_000, 300_000 * 2 ** (failures - 1));
      const value = { failures, nextAt };
      await this.prisma.cfOptimizationState.upsert({ where: { key }, create: { key, value }, update: { value } });
      // A failed worker is not evidence that every candidate or the origin is down.
      if (existing) await this.prisma.cfOptimization.updateMany({ where: { id: existing.id }, data: { error: phase, attemptedAt: new Date(now) } });
      else await this.prisma.cfOptimization.create({ data: { nodeId: node.id, probeId: probe.id, fingerprint: identity,
        carrier: probe.carrier, region: probe.region, observations: [], published: [], previous: [],
        checkedAt: new Date(0), attemptedAt: new Date(now), discoveredAt: new Date(0), error: phase } }).catch(() => undefined);
    }
  }
}
