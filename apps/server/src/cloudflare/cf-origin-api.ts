import { originRuleSpec, type OriginRoute } from './cf-origin.util';

type Rule = ReturnType<typeof originRuleSpec> & { id: string };
type Ruleset = { id: string; rules?: Rule[] };
type DnsRecord = { id: string; name: string; content: string; proxied: boolean; comment?: string };
const id = (value: string) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value ?? '')) throw new Error('Invalid Cloudflare resource ID');
  return value;
};

export class CfOriginApi {
  constructor(private token: string, private zone: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(zone)) throw new Error('Invalid original zone');
  }

  private async request<T>(path: string, method = 'GET', body?: unknown, missing = false): Promise<T | null> {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${this.zone}/${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: 'error',
    });
    if (missing && response.status === 404) { await response.body?.cancel(); return null; }
    // Provider errors may contain sensitive request data. Never propagate their body.
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Cloudflare origin ${method} failed (HTTP ${response.status}); check DNS, Zone Settings and Origin Rules permissions, quota and zone access`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Cloudflare origin response empty');
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Cloudflare origin response too large'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    let data: { success?: boolean; result?: T };
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Cloudflare origin response invalid'); }
    if (!data.success || !data.result) throw new Error('Cloudflare origin response invalid');
    return data.result;
  }

  async ensureDns(r: OriginRoute, address: string): Promise<string> {
    const records = await this.request<DnsRecord[]>(`dns_records?name=${encodeURIComponent(r.domain)}&per_page=100`);
    if (!Array.isArray(records) || records.length > 1) throw new Error('Ambiguous managed DNS hostname');
    let record = records[0];
    if (!record) record = (await this.request<DnsRecord>('dns_records', 'POST', {
      type: address.includes(':') ? 'AAAA' : 'A', name: r.domain, content: address, proxied: true, ttl: 1, comment: r.ref,
    }))!;
    if (record.name !== r.domain || record.content !== address || !record.proxied || record.comment !== r.ref) {
      throw new Error('Managed DNS ownership or target changed; overwrite refused');
    }
    return id(record.id);
  }

  async removeDns(r: OriginRoute) {
    const records = await this.request<DnsRecord[]>(`dns_records?name=${encodeURIComponent(r.domain)}&per_page=100`);
    if (!Array.isArray(records) || records.length > 1) throw new Error('Ambiguous managed DNS cleanup');
    const record = records[0];
    if (!record) return;
    if (record.name !== r.domain || record.comment !== r.ref) throw new Error('DNS ownership changed; cleanup refused');
    await this.request(`dns_records/${id(record.id)}`, 'DELETE', undefined, true);
    const after = await this.request<DnsRecord[]>(`dns_records?name=${encodeURIComponent(r.domain)}&per_page=100`);
    if (!Array.isArray(after) || after.length) throw new Error('DNS cleanup not confirmed');
  }

  async prerequisites(recordId: string, domain: string, address?: string, ref?: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(recordId)) throw new Error('Missing managed DNS record');
    const dns = await this.request<DnsRecord>(`dns_records/${recordId}`);
    if (!dns?.proxied || dns.name !== domain) throw new Error('Origin mapping requires the original proxied DNS hostname');
    if (address && dns.content !== address) throw new Error('Managed origin DNS address changed');
    if (ref && dns.comment !== ref) throw new Error('Managed DNS ownership changed');
    const ssl = await this.request<{ value: string }>('settings/ssl');
    if (ssl?.value !== 'strict') throw new Error('Origin mapping requires existing Full (strict) TLS; zone-wide settings will not be changed automatically');
  }

  private async entrypoint() {
    return this.request<Ruleset>('rulesets/phases/http_request_origin/entrypoint', 'GET', undefined, true);
  }

  private verifyRule(rule: Rule, r: OriginRoute) {
    id(rule.id);
    const wanted = originRuleSpec(r);
    if (rule.ref !== r.ref || rule.expression !== wanted.expression || rule.action !== 'route' || rule.enabled !== true
      || JSON.stringify(rule.action_parameters) !== JSON.stringify(wanted.action_parameters)
      || (r.ruleId && rule.id !== r.ruleId)) throw new Error('Origin rule drift or ownership mismatch; automatic overwrite refused');
  }

  private verifyIsolation(rules: Rule[], r: OriginRoute) {
    for (const rule of rules.filter(x => x.enabled !== false && x.ref !== r.ref)) {
      // Do not guess the effect of arbitrary Rules language or overwrite website routing.
      const host = /^\(?http\.host eq "([a-z0-9.-]+)"\)?$/.exec(rule.expression)?.[1];
      if (!host || host === r.domain) throw new Error('An existing origin rule may overlap this hostname; manual rule review required');
    }
  }

  async ensure(r: OriginRoute): Promise<OriginRoute> {
    let set = await this.entrypoint();
    if (r.rulesetId && set?.id !== r.rulesetId) throw new Error('Original origin ruleset changed');
    this.verifyIsolation(set?.rules ?? [], r);
    const matches = (set?.rules ?? []).filter(x => x.ref === r.ref);
    if (matches.length > 1) throw new Error('Duplicate owned origin rules');
    if (matches[0]) this.verifyRule(matches[0], r);
    else {
      if (r.ruleId) throw new Error('Owned origin rule was removed; explicit review required');
      // Never PUT the complete ruleset: that could erase unrelated website rules.
      if (!set) set = await this.request<Ruleset>('rulesets', 'POST', {
        name: 'Origin Rules', kind: 'zone', phase: 'http_request_origin', rules: [originRuleSpec(r)],
      });
      else await this.request(`rulesets/${id(set.id)}/rules`, 'POST', originRuleSpec(r));
    }
    return this.verify(r);
  }

  async verify(r: OriginRoute): Promise<OriginRoute> {
    const set = await this.entrypoint();
    if (!set || (r.rulesetId && set.id !== r.rulesetId)) throw new Error('Original origin ruleset is missing or changed');
    id(set.id);
    this.verifyIsolation(set.rules ?? [], r);
    const matches = (set.rules ?? []).filter(x => x.ref === r.ref);
    if (matches.length !== 1) throw new Error('Owned origin rule is missing or duplicated');
    this.verifyRule(matches[0], r);
    return { ...r, rulesetId: set.id, ruleId: matches[0].id };
  }

  async remove(r: OriginRoute) {
    const set = await this.entrypoint();
    if (!set) return;
    if (r.rulesetId && set.id !== r.rulesetId) throw new Error('Original origin ruleset changed; cleanup refused');
    const matches = (set.rules ?? []).filter(x => x.ref === r.ref);
    if (matches.length > 1) throw new Error('Duplicate owned origin rules; cleanup refused');
    if (!matches[0]) return;
    this.verifyRule(matches[0], r);
    await this.request(`rulesets/${id(set.id)}/rules/${id(matches[0].id)}`, 'DELETE', undefined, true);
    const after = await this.entrypoint();
    if (after?.rules?.some(x => x.ref === r.ref)) throw new Error('Origin cleanup not confirmed');
  }
}
