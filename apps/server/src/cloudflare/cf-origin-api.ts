import { originRuleSpec, originTlsRuleSpec, type OriginRoute } from './cf-origin.util';

type Rule = ReturnType<typeof originRuleSpec> & { id: string };
type Ruleset = { id: string; rules?: Rule[] };
type TlsRule = ReturnType<typeof originTlsRuleSpec> & { id: string };
type TlsRuleset = { id: string; rules?: TlsRule[] };
type TlsRoute = Pick<OriginRoute, 'domain' | 'ref' | 'tlsRuleId' | 'tlsRulesetId'>;
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
      const operation = path === 'settings/ssl' ? 'SSL settings (requires Zone Settings Read)'
        : path.includes('http_config_settings') ? 'Configuration Rules (requires Config Settings Read/Write)'
        : path.startsWith('rulesets') ? 'Origin Rules (requires Origin Read/Write)'
        : 'DNS records (requires DNS Read/Edit)';
      throw new Error(`Cloudflare ${operation}: ${method} failed (HTTP ${response.status}); check token permissions and access to the original zone`);
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
    await this.checkTls(domain, ref);
  }

  private async checkTls(domain?: string, ref?: string) {
    const ssl = await this.request<{ value: string }>('settings/ssl');
    if (domain && ref) {
      const set = await this.tlsEntrypoint();
      this.verifyTlsIsolation(set?.rules ?? [], { domain, ref });
      if (set?.rules?.some(rule => rule.ref === `${ref}_tls`)) await this.verifyTls({ domain, ref });
    }
    if (ssl?.value !== 'strict') {
      if (!domain || !ref) throw new Error('Origin mapping requires Full (strict) TLS on the exact hostname; zone-wide settings will not be changed automatically');
      await this.verifyTls({ domain, ref });
    }
  }

  /** Read-only checks precede DNS writes. Read access alone cannot prove write permission. */
  async preflight(r?: OriginRoute) {
    const ssl = await this.request<{ value: string }>('settings/ssl');
    if (!ssl || !['off', 'flexible', 'full', 'strict', 'origin_pull'].includes(ssl.value)) throw new Error('Cloudflare SSL settings response invalid');
    const tls = await this.tlsEntrypoint();
    if (r) this.verifyTlsIsolation(tls?.rules ?? [], r);
    const set = await this.entrypoint();
    if (r) this.verifyIsolation(set?.rules ?? [], r);
    if (!Array.isArray(await this.request<DnsRecord[]>('dns_records?per_page=1'))) throw new Error('Cloudflare DNS response invalid');
  }

  private async entrypoint() {
    return this.validateRuleset(await this.request<Ruleset>('rulesets/phases/http_request_origin/entrypoint', 'GET', undefined, true));
  }

  private validateRuleset<T extends Ruleset | TlsRuleset>(set: T | null): T | null {
    if (set === null) return null;
    id(set.id);
    if (set.rules !== undefined && (!Array.isArray(set.rules) || set.rules.some(rule => !rule
      || typeof rule.expression !== 'string' || typeof rule.action !== 'string'
      || (rule.ref !== undefined && typeof rule.ref !== 'string')))) throw new Error('Cloudflare ruleset response invalid');
    return set;
  }

  private verifyRule(rule: Rule, r: OriginRoute) {
    id(rule.id);
    const wanted = originRuleSpec(r);
    if (rule.ref !== r.ref || rule.expression !== wanted.expression || rule.action !== 'route' || rule.enabled !== true
      || JSON.stringify(rule.action_parameters) !== JSON.stringify(wanted.action_parameters)
      || (r.ruleId && rule.id !== r.ruleId)) throw new Error('Origin rule drift or ownership mismatch; automatic overwrite refused');
  }

  private verifyIsolation(rules: Array<{ ref?: string; expression: string; enabled?: boolean }>, r: Pick<OriginRoute, 'ref' | 'domain'>) {
    for (const rule of rules.filter(x => x.enabled !== false && x.ref !== r.ref)) {
      // Do not guess the effect of arbitrary Rules language or overwrite website routing.
      const host = /^\(?http\.host eq "([a-z0-9.-]+)"\)?$/.exec(rule.expression)?.[1];
      if (!host || host === r.domain) throw new Error('An existing origin rule may overlap this hostname; manual rule review required');
    }
  }

  private async tlsEntrypoint() {
    return this.validateRuleset(await this.request<TlsRuleset>('rulesets/phases/http_config_settings/entrypoint', 'GET', undefined, true));
  }

  private verifyTlsIsolation(rules: TlsRule[], r: TlsRoute) {
    this.verifyIsolation(rules.filter(rule => rule.action_parameters?.ssl !== undefined), { ...r, ref: `${r.ref}_tls` });
  }

  private verifyTlsRule(rule: TlsRule, r: TlsRoute) {
    const expected = originTlsRuleSpec(r);
    id(rule.id);
    if (rule.ref !== expected.ref || rule.expression !== expected.expression || rule.action !== expected.action
      || rule.enabled !== true || JSON.stringify(rule.action_parameters) !== JSON.stringify(expected.action_parameters)
      || (r.tlsRuleId && r.tlsRuleId !== rule.id)) throw new Error('Hostname TLS rule drift or ownership mismatch');
  }

  async ensureTls(r: OriginRoute): Promise<OriginRoute> {
    let set = await this.tlsEntrypoint();
    if (r.tlsRulesetId && set?.id !== r.tlsRulesetId) throw new Error('Original TLS ruleset changed');
    this.verifyTlsIsolation(set?.rules ?? [], r);
    const matches = (set?.rules ?? []).filter(rule => rule.ref === `${r.ref}_tls`);
    if (matches.length > 1) throw new Error('Duplicate owned TLS rules');
    if (matches[0]) this.verifyTlsRule(matches[0], r);
    else {
      if (r.tlsRuleId) throw new Error('Owned TLS rule removed; explicit review required');
      if (!set) set = await this.request<TlsRuleset>('rulesets', 'POST', {
        name: 'NextPanel hostname TLS', kind: 'zone', phase: 'http_config_settings', rules: [originTlsRuleSpec(r)],
      });
      else await this.request(`rulesets/${id(set.id)}/rules`, 'POST', originTlsRuleSpec(r));
    }
    return { ...r, ...await this.verifyTls(r) };
  }

  private async verifyTls(r: TlsRoute) {
    const set = await this.tlsEntrypoint();
    if (!set || (r.tlsRulesetId && set.id !== r.tlsRulesetId)) throw new Error('Hostname TLS ruleset is missing or changed');
    this.verifyTlsIsolation(set.rules ?? [], r);
    const matches = (set.rules ?? []).filter(rule => rule.ref === `${r.ref}_tls`);
    if (matches.length !== 1) throw new Error('Owned strict hostname TLS rule is missing or duplicated');
    this.verifyTlsRule(matches[0], r);
    return { tlsRulesetId: id(set.id), tlsRuleId: id(matches[0].id) };
  }

  private async removeTls(r: OriginRoute) {
    const set = await this.tlsEntrypoint();
    if (!set) return;
    if (r.tlsRulesetId && set.id !== r.tlsRulesetId) throw new Error('Original TLS ruleset changed; cleanup refused');
    const matches = (set.rules ?? []).filter(rule => rule.ref === `${r.ref}_tls`);
    if (matches.length > 1) throw new Error('Duplicate owned TLS rules; cleanup refused');
    if (!matches[0]) return;
    this.verifyTlsRule(matches[0], r);
    await this.request(`rulesets/${id(set.id)}/rules/${id(matches[0].id)}`, 'DELETE', undefined, true);
    const after = await this.tlsEntrypoint();
    if (after?.rules?.some(rule => rule.ref === `${r.ref}_tls`)) throw new Error('Hostname TLS cleanup not confirmed');
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
    if (r.tlsRuleId || r.tlsRulesetId) await this.verifyTls(r);
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
    await this.removeOrigin(r);
    await this.removeTls(r);
  }

  private async removeOrigin(r: OriginRoute) {
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
