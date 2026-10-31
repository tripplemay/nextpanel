import { createHash } from 'crypto';
import { BlockList, isIP } from 'net';
import { CF_IP_RANGES, isCloudflareIp } from './cf-access.util';
import type { NodeExportInfo } from './uri-builder';

export const CARRIERS = ['GENERIC', 'TELECOM', 'UNICOM', 'MOBILE'] as const;
export type CfCarrier = typeof CARRIERS[number];
export const CF_LABELS: Record<CfCarrier | 'DNS', string> = {
  GENERIC: '通用候选', TELECOM: '电信优选', UNICOM: '联通优选', MOBILE: '移动优选', DNS: '默认 CDN',
};
export const FRESH_MS = 30 * 60_000;
export const STALE_MS = 24 * 60 * 60_000;
export interface CfProbe {
  id: string; url: string; tokenEnv: string; carrier: CfCarrier; region: string;
  expectedEgressIp?: string; verifiedAt?: string;
}
export interface CfObservation {
  ip: string; passed: number; failed: number; latency: number; checkedAt: number;
  bytesPerSecond?: number; bandwidthAt?: number;
}
export interface CfMeasurement { ip: string; ok: boolean; latency: number; bytes?: number; durationMs?: number }

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function probeRegistry(raw: string | undefined, now = Date.now()): CfProbe[] {
  if (!raw) return [];
  const probes = JSON.parse(raw) as CfProbe[];
  if (!Array.isArray(probes) || probes.length > 9) throw new Error('Invalid CF probe registry');
  const ids = new Set<string>();
  for (const p of probes) {
    const url = new URL(p.url);
    if (!/^[a-z0-9-]{1,40}$/.test(p.id) || ids.has(p.id) || url.protocol !== 'https:' || url.username || url.password
      || url.search || url.hash || !/^[A-Z][A-Z0-9_]{2,80}$/.test(p.tokenEnv) || !CARRIERS.includes(p.carrier)
      || typeof p.region !== 'string' || p.region.length < 1 || p.region.length > 80) throw new Error('Invalid CF probe registry');
    if (p.carrier !== 'GENERIC' && (!p.expectedEgressIp || !isIP(p.expectedEgressIp) || !p.verifiedAt
      || !Number.isFinite(Date.parse(p.verifiedAt)) || Date.parse(p.verifiedAt) > now
      || now - Date.parse(p.verifiedAt) > 30 * 86400_000)) throw new Error('Carrier probe requires recent verified egress evidence');
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
  return retained.sort(compare).slice(0, 3);
}

export function automaticVariants(node: NodeExportInfo, nodeId: string, profiles: { carrier: CfCarrier; ips: string[] }[], defaultIp: string | null): NodeExportInfo[] {
  const base = `${node.name} [CF ${nodeId}]`;
  const carriers = profiles.filter(p => p.carrier !== 'GENERIC');
  const selected = carriers.length ? carriers : profiles;
  const endpoints = selected.flatMap(p => [...new Set(p.ips)].slice(0, 3).map((ip, i) => ({ ip, carrier: p.carrier as CfCarrier | 'DNS', label: `${CF_LABELS[p.carrier]} ${i + 1}` })));
  if (defaultIp) endpoints.push({ ip: defaultIp, carrier: 'DNS', label: CF_LABELS.DNS });
  return endpoints.map(e => ({ ...node, host: e.ip, name: `${base} ${e.label} [CF:${e.carrier}]`,
    cfGroup: base, cfAuto: true, cfNodeId: nodeId, cfCarrier: e.carrier,
    credentials: { ...node.credentials, transportHost: node.domain! },
  }));
}
