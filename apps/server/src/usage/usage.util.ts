import { createHash } from 'crypto';
import { isIP } from 'net';
import type { NodeExportInfo } from '../subscriptions/uri-builder';

export const USAGE_LIMIT = 500;
export const USAGE_FRESH_MS = 90_000;
export const USAGE_ACTIVE_MS = 60_000;
export const LEGACY_EMAIL = 'np-legacy';
export const usageEmail = (id: string) => `np-usage-${id}`;
export const grantVersion = (token: string) => createHash('sha256').update(token).digest('hex');
export function usageEligible(n: { protocol: string; implementation: string | null; transport: string | null; tls: string; cfDnsRecordId?: string | null }) {
  return n.protocol === 'VLESS' && (n.implementation === 'XRAY' || n.implementation === null)
    && n.transport === 'WS' && n.tls === 'TLS' && !!n.cfDnsRecordId;
}
export function candidateKey(node: NodeExportInfo): string {
  if (!isIP(node.host)) throw new Error('Usage candidates require a literal CDN address');
  return createHash('sha256').update(JSON.stringify([node.host, node.port, node.domain,
    node.transport, node.tls, node.cfCarrier ?? 'MANUAL', Object.keys(node.credentials).sort().map(key => [key, node.credentials[key]])])).digest('hex');
}
export function usageStatus(sampledAt: Date | null, activeAt: Date | null, installed: boolean, now = Date.now()) {
  if (!installed) return 'PENDING';
  if (!sampledAt || now - sampledAt.getTime() > USAGE_FRESH_MS) return 'STALE';
  return activeAt && now - activeAt.getTime() <= USAGE_ACTIVE_MS ? 'ACTIVE' : 'IDLE';
}
export function counterDelta(current: bigint, previous: bigint, seconds: number, reset: boolean) {
  if (reset || seconds <= 0 || seconds > USAGE_FRESH_MS / 1000 || current < previous) return { bytes: 0n, rate: null };
  const bytes = current - previous;
  return { bytes, rate: Number(bytes) / seconds };
}
