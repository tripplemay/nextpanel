import { CfOriginApi } from './cf-origin-api';
import { originReady, originRoute, originRuleSpec, publicPort, type OriginRoute } from './cf-origin.util';
import { originFirewall, installOriginFirewall, verifyOriginFirewall, removeOriginFirewall } from './cf-origin-firewall';
import { isCfManagedNode } from '../subscriptions/cf-access.util';
import { nodeFingerprint } from '../subscriptions/cf-optimization.service';
import { CfOriginService } from './cf-origin.service';

jest.mock('../common/database/advisory-lock', () => ({ withPostgresAdvisoryLocks: (_: string[], fn: () => unknown) => fn() }));

const route: OriginRoute = { version: 1, zoneId: 'zone', ref: `np_origin_${'a'.repeat(32)}`, domain: 'pilot.example.com',
  port: 8443, state: 'PENDING' };
const node = { id: 'pilot', publicPort: 443, listenPort: 8443, userId: 'owner', domain: route.domain, cfDnsRecordId: 'dns',
  protocol: 'VLESS', transport: 'XHTTP', tls: 'TLS', server: { ip: '192.0.2.1' } };
const ready = { ...route, state: 'READY', checkedAt: new Date().toISOString(), rulesetId: 'set', ruleId: 'rule' };
const response = (result: unknown, status = 200) => new Response(JSON.stringify({ success: status === 200, result }), { status });

describe('CDN endpoint separation', () => {
  it('preserves old ports and never exports the mapped source port', () => {
    expect(publicPort({ listenPort: 443 })).toBe(443);
    expect(publicPort({ listenPort: 10000 })).toBe(10000);
    expect(publicPort(node)).toBe(443);
    expect(isCfManagedNode({ ...node, cfOriginRoute: ready })).toBe(true);
    expect(isCfManagedNode({ ...node, publicPort: null, cfOriginRoute: ready })).toBe(false);
  });
  it.each(['PENDING', 'CONFIGURED', 'ERROR'])('does not publish %s mappings', state => {
    expect(originReady({ ...node, cfOriginRoute: { ...ready, state } })).toBe(false);
  });
  it.each([{ checkedAt: 'invalid' }, { checkedAt: new Date(Date.now() - 21 * 60_000).toISOString() },
    { checkedAt: new Date(Date.now() + 60000).toISOString() }, { port: 8444 }, { domain: 'other.example.com' }, { ruleId: null }])(
    'rejects stale or mismatched mappings %j', override => {
      expect(originReady({ ...node, cfOriginRoute: { ...ready, ...override } })).toBe(false);
    });
  it.each([{ port: 0 }, { zoneId: '../zone' }, { domain: 'x" or true' }, { ruleId: '../rule' }, { ref: 'other-panel' }])(
    'rejects malformed persisted metadata %j', override => expect(() => originRoute({ ...route, ...override })).toThrow());
  it('invalidates candidates on mapping identity changes, not periodic checks', () => {
    const before = nodeFingerprint({ ...node, cfOriginRoute: ready });
    expect(nodeFingerprint({ ...node, cfOriginRoute: { ...ready, checkedAt: 'later', state: 'ERROR' } })).toBe(before);
    expect(nodeFingerprint({ ...node, cfOriginRoute: { ...ready, ruleId: 'replacement' } })).not.toBe(before);
  });
});

describe('Cloudflare origin API isolation', () => {
  let fetcher: jest.SpyInstance;
  let rules: any[];
  let present: boolean;
  let writes: Array<{ method: string; url: string; body: any }>;
  beforeEach(() => {
    rules = [{ id: 'website', ref: 'website', expression: '(http.host eq "www.example.com")', enabled: true,
      action: 'route', action_parameters: { origin: { port: 443 } } }];
    present = true; writes = [];
    fetcher = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input); const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (method !== 'GET') writes.push({ method, url, body });
      if (url.endsWith('/settings/ssl')) return response({ value: 'strict' });
      if (url.endsWith('/dns_records/dns')) return response({ name: route.domain, proxied: true });
      if (url.endsWith('/entrypoint')) return present ? response({ id: 'set', rules }) : response(null, 404);
      if (method === 'POST' && url.endsWith('/rulesets')) { present = true; rules = body.rules.map((r: any) => ({ ...r, id: 'rule' })); }
      else if (method === 'POST') rules.push({ ...body, id: 'rule' });
      else if (method === 'DELETE') rules = rules.filter(r => r.id !== 'rule');
      return response({ id: 'set', rules });
    });
  });
  afterEach(() => fetcher.mockRestore());
  it('appends only an exact-host port rule and leaves the website unchanged', async () => {
    const site = structuredClone(rules[0]);
    const api = new CfOriginApi('private-fixture', 'zone');
    await api.prerequisites('dns', route.domain);
    expect(await api.ensure(route)).toMatchObject({ rulesetId: 'set', ruleId: 'rule' });
    expect(rules[0]).toEqual(site);
    expect(writes).toEqual([{ method: 'POST', url: 'https://api.cloudflare.com/client/v4/zones/zone/rulesets/set/rules', body: originRuleSpec(route) }]);
    expect(writes[0].body.action_parameters).toEqual({ origin: { port: 8443 } });
  });
  it('creates a missing entrypoint without replacing a ruleset', async () => {
    present = false;
    await new CfOriginApi('private-fixture', 'zone').ensure(route);
    expect(writes[0].body).toMatchObject({ kind: 'zone', phase: 'http_request_origin' });
    expect(writes.some(w => w.method === 'PUT')).toBe(false);
  });
  it('recovers a lost creation response by stable ownership ref without duplicating rules', async () => {
    rules.push({ ...originRuleSpec(route), id: 'rule' });
    await new CfOriginApi('private-fixture', 'zone').ensure(route);
    expect(writes).toEqual([]);
  });
  it.each(['true', '(http.host eq "pilot.example.com")', 'ends_with(http.host, "example.com")'])(
    'refuses a possibly overlapping existing rule %s', async expression => {
      rules[0].expression = expression;
      await expect(new CfOriginApi('private-fixture', 'zone').ensure(route)).rejects.toThrow('overlap');
      expect(writes).toEqual([]);
    });
  it('does not repair or delete a rule modified by someone else', async () => {
    rules.push({ ...originRuleSpec(route), id: 'rule', action_parameters: { origin: { port: 9443 } } });
    const api = new CfOriginApi('private-fixture', 'zone');
    await expect(api.ensure(route)).rejects.toThrow('drift');
    await expect(api.remove(route)).rejects.toThrow('drift');
    expect(writes).toEqual([]);
  });
  it('deletes only the owned rule and supports repeated cleanup', async () => {
    rules.push({ ...originRuleSpec(route), id: 'rule' });
    const api = new CfOriginApi('private-fixture', 'zone');
    await api.remove(route); await api.remove(route);
    expect(writes).toHaveLength(1); expect(writes[0].method).toBe('DELETE');
    expect(rules.map(r => r.id)).toEqual(['website']);
  });
  it.each([403, 429, 500])('reports provider failure %s without leaking response bodies', async status => {
    fetcher.mockResolvedValue(response({ token: 'private-fixture' }, status));
    await expect(new CfOriginApi('private-fixture', 'zone').ensure(route)).rejects.toThrow(`HTTP ${status}`);
    await expect(new CfOriginApi('private-fixture', 'zone').ensure(route)).rejects.not.toThrow('private-fixture');
  });
  it('never edits zone-wide TLS to make a new node work', async () => {
    fetcher.mockImplementation(async input => String(input).endsWith('/settings/ssl')
      ? response({ value: 'flexible' }) : response({ name: route.domain, proxied: true }));
    await expect(new CfOriginApi('private-fixture', 'zone').prerequisites('dns', route.domain)).rejects.toThrow('Full (strict)');
    expect(writes).toEqual([]);
  });
});

describe('scoped origin firewall', () => {
  it('restricts both IP families on the new TCP port only and restores before each start', () => {
    const f = originFirewall('pilot', 8443, route.ref);
    expect(f.config).toContain('tcp dport 8443 ip saddr !=');
    expect(f.config).toContain('tcp dport 8443 ip6 saddr !=');
    expect(f.config).not.toMatch(/dport 443\b|flush ruleset|policy drop/);
    expect(f.guard).toContain('nft -c -f'); expect(f.guard).toContain('ownership mismatch');
  });
  it('fails closed when nftables is unavailable and never replaces a website firewall', async () => {
    const ssh = { execCommand: jest.fn().mockResolvedValue({ code: 1, stdout: '', stderr: '' }) };
    await expect(installOriginFirewall(ssh as any, 'pilot', 8443, route.ref)).rejects.toThrow('CF-only');
    await expect(verifyOriginFirewall(ssh as any, 'pilot', 8443, route.ref)).rejects.toThrow('changed');
    await expect(removeOriginFirewall(ssh as any, 'pilot', 8443, route.ref)).rejects.toThrow('cleanup');
    expect(ssh.execCommand.mock.calls.map(x => x[0]).join('\n')).not.toMatch(/flush ruleset|systemctl.*nginx|ufw reset/);
  });
});

describe('durable DNS ownership', () => {
  let fetcher: jest.SpyInstance;
  let records: any[];
  beforeEach(() => {
    records = [];
    fetcher = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        const record = { ...JSON.parse(String(init.body)), id: 'dns' };
        records.push(record); return response(record);
      }
      if (init?.method === 'DELETE') { records = []; return response({ id: 'dns' }); }
      return response(records);
    });
  });
  afterEach(() => fetcher.mockRestore());
  it('recovers a response loss without duplicating DNS and deletes by original intent', async () => {
    const api = new CfOriginApi('fixture', 'zone');
    await api.ensureDns(route, '192.0.2.1');
    await api.ensureDns(route, '192.0.2.1');
    expect(records).toHaveLength(1); expect(records[0].comment).toBe(route.ref);
    await api.removeDns(route); await api.removeDns(route);
    expect(records).toEqual([]);
    expect(fetcher.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1);
  });
  it('does not adopt or delete a website DNS record', async () => {
    records = [{ id: 'website', name: route.domain, content: '192.0.2.1', proxied: true, comment: 'website-owner' }];
    const api = new CfOriginApi('fixture', 'zone');
    await expect(api.ensureDns(route, '192.0.2.1')).rejects.toThrow('ownership');
    await expect(api.removeDns(route)).rejects.toThrow('ownership');
    expect(fetcher.mock.calls.every(c => c[1]?.method === 'GET')).toBe(true);
  });
});

describe('durable origin provisioning', () => {
  it('requires source firewall support before persisting intent or creating cloud resources', async () => {
    const update = jest.fn(); const token = jest.fn();
    const ssh = { execCommand: jest.fn().mockResolvedValue({ code: 1 }), dispose: jest.fn() };
    const service = new CfOriginService({ node: { findUniqueOrThrow: async () => node, update } } as any,
      { getDecryptedToken: token } as any, { connect: async () => ssh } as any);
    await expect(service.prepare('pilot')).rejects.toThrow('nftables');
    expect(ssh.dispose).toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  });
  it.each([true, false])('audit preserves acceptance only while remote ownership is valid=%s', async valid => {
    const candidate = { ...node, cfOriginRoute: ready, status: 'RUNNING', enabled: true };
    const db = { node: { findMany: jest.fn().mockResolvedValue([candidate]), findUnique: jest.fn().mockResolvedValue(candidate),
      updateMany: jest.fn() } };
    const ssh = { dispose: jest.fn(), execCommand: jest.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }) };
    const resources = { connect: jest.fn().mockResolvedValue(ssh), assertUnchangedDeployment: jest.fn(async () => {
      if (!valid) throw new Error('Remote ownership changed');
    }) };
    const service = new CfOriginService(db as any, {} as any, resources as any);
    const accept = jest.spyOn(service, 'ready').mockResolvedValue();
    await service.audit();
    expect(accept).toHaveBeenCalledTimes(valid ? 1 : 0);
    expect(ssh.dispose).toHaveBeenCalled();
    if (!valid) expect(db.node.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { cfOriginRoute: expect.objectContaining({ state: 'ERROR', error: 'Remote ownership changed' }) },
    }));
  });

  it('audit cannot accept an undeployed or withdrawn mapping', async () => {
    const candidate = { ...node, cfOriginRoute: route, status: 'RUNNING', enabled: true };
    const resources = { connect: jest.fn() };
    const service = new CfOriginService({ node: { findMany: async () => [candidate], findUnique: async () => candidate } } as any,
      {} as any, resources as any);
    const accept = jest.spyOn(service, 'ready').mockResolvedValue();
    await service.audit();
    expect(accept).not.toHaveBeenCalled(); expect(resources.connect).not.toHaveBeenCalled();
  });

  it('withdrawal clears audit eligibility while retaining cleanup ownership', async () => {
    const update = jest.fn();
    const service = new CfOriginService({ node: { update } } as any, {} as any, {} as any);
    await service.withdraw('pilot', ready);
    expect(update).toHaveBeenCalledWith({ where: { id: 'pilot' }, data: { cfOriginRoute: expect.objectContaining({
      ref: route.ref, zoneId: route.zoneId, ruleId: 'rule', state: 'CONFIGURED', checkedAt: null,
    }) } });
  });

  it('saves intent before a provider write and retains it after a timeout', async () => {
    const updates: any[] = [];
    const db = { node: { findUniqueOrThrow: jest.fn().mockResolvedValue(node),
      update: jest.fn(async x => updates.push(x)), updateMany: jest.fn(async x => updates.push(x)) } };
    const service = new CfOriginService(db as any, { getDecryptedToken: async () => ({ apiToken: 'private', zoneId: 'zone' }) } as any,
      { instanceId: async () => 'panel-instance', connect: async () => ({
        execCommand: async () => ({ code: 0 }), dispose: jest.fn(),
      }) } as any);
    const prereq = jest.spyOn(CfOriginApi.prototype, 'prerequisites').mockResolvedValue();
    const dns = jest.spyOn(CfOriginApi.prototype, 'ensureDns').mockResolvedValue('dns');
    const ensure = jest.spyOn(CfOriginApi.prototype, 'ensure').mockImplementation(async r => {
      expect(updates[0].data.cfOriginRoute).toMatchObject({ ref: r.ref, state: 'PENDING', port: 8443 });
      throw new Error('Provider timeout');
    });
    try {
      await expect(service.prepare('pilot')).rejects.toThrow('timeout');
      expect(updates.at(-1).data.cfOriginRoute).toMatchObject({ state: 'ERROR', port: 8443, zoneId: 'zone' });
    } finally { prereq.mockRestore(); ensure.mockRestore(); dns.mockRestore(); }
  });
});
