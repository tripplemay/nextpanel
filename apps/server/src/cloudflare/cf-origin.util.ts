import { isFQDN } from 'class-validator';

export interface OriginRoute {
  version: 1;
  zoneId: string;
  ref: string;
  domain: string;
  port: number;
  rulesetId?: string;
  ruleId?: string;
  tlsRulesetId?: string;
  tlsRuleId?: string;
  state: 'PENDING' | 'CONFIGURED' | 'READY' | 'ERROR';
  checkedAt?: string;
  auditedAt?: string;
  error?: string;
}

export function originRoute(value: unknown): OriginRoute {
  const r = value as OriginRoute | null;
  if (!r || r.version !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.zoneId ?? '')
    || !/^np_origin_[a-f0-9]{32}$/.test(r.ref ?? '') || typeof r.domain !== 'string'
    || !isFQDN(r.domain) || !/^[a-z0-9.-]+$/.test(r.domain) || r.domain.length > 253
    || !Number.isInteger(r.port) || r.port < 1024 || r.port > 65535
    || !['PENDING', 'CONFIGURED', 'READY', 'ERROR'].includes(r.state)
    || [r.rulesetId, r.ruleId, r.tlsRulesetId, r.tlsRuleId].some(id => id !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    throw new Error('Invalid Cloudflare origin route; manual review required');
  }
  return r;
}

export function publicPort(node: { listenPort: number; publicPort?: number | null }): number {
  return node.publicPort ?? node.listenPort;
}

export function originReady(node: { listenPort: number; publicPort?: number | null; domain: string | null; cfOriginRoute?: unknown }): boolean {
  if (node.publicPort == null) return node.listenPort === 443;
  try {
    const r = originRoute(node.cfOriginRoute);
    const age = Date.now() - Date.parse(r.checkedAt ?? '');
    return node.publicPort === 443 && r.domain === node.domain && r.port === node.listenPort
      && r.state === 'READY' && !!r.ruleId && !!r.rulesetId && age >= 0 && age < 20 * 60_000;
  } catch { return false; }
}

export function originRuleSpec(r: OriginRoute) {
  return { ref: r.ref, description: r.ref, expression: `(http.host eq "${r.domain}")`,
    action: 'route', enabled: true, action_parameters: { origin: { port: r.port } } };
}

export function originTlsRuleSpec(r: Pick<OriginRoute, 'ref' | 'domain'>) {
  return { ref: `${r.ref}_tls`, description: `${r.ref}_tls`, expression: `(http.host eq "${r.domain}")`,
    action: 'set_config', enabled: true, action_parameters: { ssl: 'strict' } };
}
