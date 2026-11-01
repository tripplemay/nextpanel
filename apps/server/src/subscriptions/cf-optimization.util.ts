import { createHash } from 'crypto';
import { BlockList, isIP } from 'net';
import { CF_IP_RANGES, isCloudflareIp } from './cf-access.util';
import type { NodeExportInfo } from './uri-builder';

export const FRESH_MS = 30 * 60_000;
export const STALE_MS = 24 * 60 * 60_000;
export interface CfRegion { key: string; label: string }
export interface CfProbe {
  id: string; url: string; tokenEnv: string; region: string; regionKey?: string;
  expectedEgressIp?: string;
  nodeIds?: string[];
  /** Legacy registry metadata is retained only for snapshot identity compatibility. */
  carrier?: string; verifiedAt?: string;
}
export interface CfObservation {
  ip: string; passed: number; failed: number; latency: number; checkedAt: number;
  bytesPerSecond?: number; bandwidthAt?: number;
}
export interface CfMeasurement { ip: string; ok: boolean; latency: number; bytes?: number; durationMs?: number }

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function probeRegistry(raw: string | undefined): CfProbe[] {
  if (!raw) return [];
  const probes = JSON.parse(raw) as CfProbe[];
  if (!Array.isArray(probes) || probes.length > 9) throw new Error('Invalid CF probe registry');
  const ids = new Set<string>(); const regions = new Map<string, string>(); const labels = new Map<string, string>();
  for (const p of probes) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.url !== 'string'
      || typeof p.tokenEnv !== 'string') throw new Error('Invalid CF probe registry');
    const url = new URL(p.url);
    if (!/^[a-z0-9-]{1,40}$/.test(p.id) || ids.has(p.id) || url.protocol !== 'https:' || url.username || url.password
      || url.search || url.hash || !/^[A-Z][A-Z0-9_]{2,80}$/.test(p.tokenEnv)
      || typeof p.region !== 'string' || !/^[\p{L}\p{N} ._-]{1,40}$/u.test(p.region)) throw new Error('Invalid CF probe registry');
    if (p.regionKey !== undefined && (typeof p.regionKey !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(p.regionKey) || p.regionKey.length > 40)) throw new Error('Invalid probe region');
    if (p.expectedEgressIp !== undefined && !isIP(p.expectedEgressIp)) throw new Error('Invalid expected egress');
    if (p.carrier !== undefined && !['GENERIC', 'TELECOM', 'UNICOM', 'MOBILE'].includes(p.carrier)) throw new Error('Invalid legacy probe metadata');
    if (p.nodeIds !== undefined && (!Array.isArray(p.nodeIds) || p.nodeIds.length > 20 || new Set(p.nodeIds).size !== p.nodeIds.length
      || p.nodeIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))) throw new Error('Invalid probe node scope');
    if (p.regionKey) {
      if (regions.has(p.regionKey) && regions.get(p.regionKey) !== p.region) throw new Error('Inconsistent region labels');
      if (labels.has(p.region) && labels.get(p.region) !== p.regionKey) throw new Error('Duplicate region labels');
      regions.set(p.regionKey, p.region);
      labels.set(p.region, p.regionKey);
    }
    ids.add(p.id);
  }
  return probes;
}

export function rangeList(text: string, family: 4 | 6): string[] {
  const values = text.trim().split(/\s+/);
  if (values.length < (family === 4 ? 5 : 2) || values.length > 128) throw new Error('Invalid CF ranges');
  for (const range of values) {
    const [ip, bits, extra] = range.split('/');
    if (extra || isIP(ip) !== family || !/^\d+$/.test(bits) || +bits < (family === 4 ? 8 : 20)
      || +bits > (family === 4 ? 32 : 128) || !isCloudflareIp(ip)) throw new Error('CF range expansion requires review');
    // New official ranges cannot silently expand the probe SSRF boundary.
    const block = new BlockList();
    block.addSubnet(ip, +bits, family === 4 ? 'ipv4' : 'ipv6');
    if (family === 4) {
      const n = ip.split('.').reduce((a, b) => a * 256 + +b, 0);
      const last = n + 2 ** (32 - +bits) - 1;
      if (!isCloudflareIp([24, 16, 8, 0].map(s => (last >>> s) & 255).join('.'))) throw new Error('CF range expansion requires review');
    }
  }
  return [...new Set(values)];
}

export function allowedByRanges(ip: string, ranges: string[] = CF_IP_RANGES): boolean {
  if (!isCloudflareIp(ip)) return false;
  const block = new BlockList();
  for (const cidr of ranges) {
    const [address, bits] = cidr.split('/');
    block.addSubnet(address, +bits, isIP(address) === 6 ? 'ipv6' : 'ipv4');
  }
  return block.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

export function discoverCandidates(ranges: string[], key: string, defaults: string[], incumbents: string[]): string[] {
  const candidates = [...incumbents, ...defaults];
  // Bounded, rotating sampling; never enumerate whole CF networks or IPv6 space.
  for (const [i, cidr] of ranges.filter(r => !r.includes(':')).entries()) {
    const [ip, bits] = cidr.split('/');
    const base = ip.split('.').reduce((a, b) => a * 256 + +b, 0);
    const size = 2 ** (32 - +bits);
    const offset = parseInt(fingerprint([key, i]).slice(0, 8), 16) % size;
    const address = base + offset;
    candidates.push([24, 16, 8, 0].map(s => (address >>> s) & 255).join('.'));
  }
  return [...new Set(candidates)].filter(ip => allowedByRanges(ip, ranges)).slice(0, 64);
}

export function updateObservations(old: CfObservation[], results: CfMeasurement[], now: number): CfObservation[] {
  const entries = new Map(old.map(o => [o.ip, o]));
  for (const r of results) {
    const prior = entries.get(r.ip);
    const recent = prior && now - prior.checkedAt <= FRESH_MS;
    const ok = r.ok && Number.isFinite(r.latency) && r.latency >= 0 && r.latency <= 60_000;
    entries.set(r.ip, {
      ip: r.ip, passed: ok ? Math.min(20, (recent ? prior.passed : 0) + 1) : 0,
      failed: ok ? 0 : (prior?.failed ?? 0) + 1,
      latency: ok ? (recent && prior.passed ? Math.round((prior.latency + r.latency) / 2) : r.latency) : (prior?.latency ?? 60_000),
      checkedAt: now,
      ...(prior?.bytesPerSecond && { bytesPerSecond: prior.bytesPerSecond, bandwidthAt: prior.bandwidthAt }),
      ...(ok && r.bytes && r.durationMs && r.durationMs > 0 && { bytesPerSecond: r.bytes * 1000 / r.durationMs, bandwidthAt: now }),
    });
  }
  return [...entries.values()].filter(o => now - o.checkedAt <= STALE_MS)
    .sort((a, b) => b.checkedAt - a.checkedAt).slice(0, 64);
}

export function rankCandidates(observations: CfObservation[], incumbent: CfObservation[], now: number): CfObservation[] {
  const eligible = observations.filter(o => o.passed >= 2 && !o.failed && now - o.checkedAt <= FRESH_MS);
  const bandwidthReady = [...eligible, ...incumbent].length > 0 && [...eligible, ...incumbent]
    .every(o => o.bytesPerSecond && now - (o.bandwidthAt ?? 0) < 6 * 3600_000);
  const compare = (a: CfObservation, b: CfObservation) => {
    if (bandwidthReady) {
      return b.bytesPerSecond! - a.bytesPerSecond! || a.latency - b.latency;
    }
    return a.latency - b.latency;
  };
  eligible.sort(compare);
  const retained = incumbent.flatMap(previous => {
    const current = observations.find(o => o.ip === previous.ip);
    return current && current.failed < 2 && now - current.checkedAt <= FRESH_MS ? [current] : [];
  });
  for (const candidate of eligible) {
    if (retained.some(o => o.ip === candidate.ip)) continue;
    if (retained.length < 3) retained.push(candidate);
    else {
      retained.sort(compare);
      const worst = retained[retained.length - 1];
      const improvement = bandwidthReady ? candidate.bytesPerSecond! > worst.bytesPerSecond! * 1.2 : candidate.latency < worst.latency * 0.8;
      if (improvement && compare(candidate, worst) < 0) retained[retained.length - 1] = candidate;
    }
  }
  const ranked = retained.sort((a, b) => a.failed - b.failed || compare(a, b)).slice(0, 3);
  const primary = ranked.find(o => o.ip === incumbent[0]?.ip && !o.failed);
  const best = ranked[0];
  // A compact export has one regional slot. Keep its healthy incumbent when
  // the gain is marginal, rather than rotating the dialed IP every probe round.
  if (primary && best && !(bandwidthReady ? best.bytesPerSecond! > primary.bytesPerSecond! * 1.2 : best.latency < primary.latency * 0.8)) {
    return [primary, ...ranked.filter(o => o.ip !== primary.ip)];
  }
  return ranked;
}

export function automaticVariants(node: NodeExportInfo, nodeId: string, profiles: { region?: CfRegion; ips: string[] }[], defaultIp: string | null, regions: CfRegion[] = profiles.flatMap(p => p.region ? [p.region] : [])): NodeExportInfo[] {
  const base = `${node.name} [CF ${nodeId}]`;
  const covered = new Set(profiles.filter(p => p.region && p.ips.length).map(p => p.region!.key));
  const needsGeneric = !covered.size || regions.some(r => !covered.has(r.key));
  type Endpoint = { ip: string; profile: string; region?: CfRegion };
  const endpoints = new Map<string, Endpoint>();
  const selected = new Set<string>();
  // Keep the measured pool for future promotion, not as a user-facing menu.
  for (const p of profiles) {
    const ip = p.ips[0];
    const profile = p.region ? `REGION:${p.region.key}` : 'GENERIC';
    if (!ip || selected.has(profile) || (!p.region && !needsGeneric)) continue;
    selected.add(profile);
    const endpoint: Endpoint = { ip, profile, region: p.region };
    const existing = endpoints.get(ip);
    // A shared IP is one connection path. GENERIC keeps cached regional filters
    // working without falsely attributing the shared path to just one region.
    endpoints.set(ip, existing && existing.profile !== endpoint.profile
      ? { ip, profile: 'GENERIC' } : endpoint);
  }
  if (defaultIp) {
    endpoints.delete(defaultIp);
    endpoints.set(defaultIp, { ip: defaultIp, profile: 'DNS' });
  }
  // Keep the old terminal GENERIC/DNS marker so cached carrier-era provider filters
  // continue to receive safe CDN endpoints until a full subscription refresh.
  const positions = new Map<string, number>();
  return [...endpoints.values()].map(e => {
    const position = (positions.get(e.profile) ?? 0) + 1;
    positions.set(e.profile, position);
    const label = e.profile === 'DNS' ? '默认 CDN' : `${e.region ? `${e.region.label}云测优选` : '通用候选'} ${position}`;
    return { ...node, host: e.ip, name: `${base} ${label} [CF-REGION:${e.region?.key ?? e.profile}] [CF:${e.profile === 'DNS' ? 'DNS' : 'GENERIC'}]`,
      cfGroup: base, cfAuto: true, cfNodeId: nodeId, cfProfile: e.profile, cfRegion: e.region, cfRegions: regions,
      credentials: { ...node.credentials, transportHost: node.domain! },
    };
  });
}

export function regionalCandidates(profiles: { region?: CfRegion; observations: CfObservation[] }[], regions: CfRegion[]) {
  return [...regions.map(region => ({ region, rows: profiles.filter(p => p.region?.key === region.key) })),
    { region: undefined, rows: profiles.filter(p => !p.region) }].map(({ region, rows }) => {
    const scores = new Map<string, { votes: number; rank: number; failures: number }>();
    for (const row of rows) {
      // Published order already incorporates comparable throughput and hysteresis.
      const sorted = [...new Map(row.observations.map(o => [o.ip, o])).values()].sort((a, b) => a.failed - b.failed);
      for (const [rank, o] of sorted.entries()) {
        const score = scores.get(o.ip) ?? { votes: 0, rank: 0, failures: 0 };
        score.votes++; score.rank += rank / Math.max(1, sorted.length); score.failures += o.failed;
        scores.set(o.ip, score);
      }
    }
    const ips = [...scores].sort(([a, x], [b, y]) => x.failures - y.failures || y.votes - x.votes
      || x.rank / x.votes - y.rank / y.votes || a.localeCompare(b)).slice(0, 3).map(([ip]) => ip);
    return { region, ips };
  }).filter(p => p.ips.length);
}
