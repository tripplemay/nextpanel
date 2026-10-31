import { CfOptimizationService, boundedText, nodeFingerprint } from './cf-optimization.service';
import { automaticVariants, allowedByRanges, discoverCandidates, fingerprint, FRESH_MS, probeRegistry,
  rankCandidates, rangeList, regionalCandidates, updateObservations } from './cf-optimization.util';
import { CF_IP_RANGES } from './cf-access.util';
import { buildClashSubscription, buildFullSingboxConfig, buildHomeProxyConfig } from './uri-builder';
import { validate } from 'class-validator';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';

jest.mock('../common/database/advisory-lock', () => ({ withPostgresAdvisoryLocks: jest.fn(async (_keys, work) => work()) }));

const now = Date.parse('2026-10-31T12:00:00Z');
const probe = { id: 'guangzhou', url: 'https://probe.example.com', tokenEnv: 'FIXTURE_CF_TOKEN', carrier: 'GENERIC' as const, region: 'Guangzhou cloud' };
const node = { id: 'node', userId: 'owner', name: 'Hong Kong', protocol: 'VLESS', transport: 'WS', tls: 'TLS',
  listenPort: 443, domain: 'cdn.example.com', cfDnsRecordId: 'record', credentialsEnc: 'encrypted-fixture',
  enabled: true, status: 'RUNNING', server: { ip: '192.0.2.1' } };
const exported = { ...node, host: node.domain, port: 443, credentials: { uuid: '00000000-0000-4000-8000-000000000001', path: '/ws' } };
const observation = (ip: string, latency = 100) => ({ ip, latency, passed: 2, failed: 0, checkedAt: now });
const guangzhou = { key: 'ap-guangzhou', label: '广州' };
const chengdu = { key: 'ap-chengdu', label: '成都' };
const beijing = { key: 'ap-beijing', label: '北京' };

describe('bounded discovery and regional attribution', () => {
  it('preserves legacy registry fingerprints without inventing a region from names', () => {
    expect(probeRegistry(JSON.stringify([probe]))).toEqual([probe]);
    expect(probeRegistry(JSON.stringify([{ ...probe, carrier: 'TELECOM' }]))[0].regionKey).toBeUndefined();
    expect(probeRegistry(JSON.stringify([{ ...probe, regionKey: guangzhou.key, region: guangzhou.label }]))[0].regionKey).toBe(guangzhou.key);
  });
  it.each([
    { url: 'http://probe.example.com' }, { url: 'https://user:password@probe.example.com' }, { url: 'https://probe.example.com?token=secret' },
    { tokenEnv: '../secret' }, { carrier: 'FAKE' }, { region: '' },
    { regionKey: 'ap-guangzhou|DNS' }, { regionKey: 'guangzhou' }, { region: '广州[CF:DNS]' },
    { expectedEgressIp: 'hostname' }, { nodeIds: ['node', 'node'] }, { nodeIds: 'node' },
  ])('rejects unsafe registry entry %j', override => {
    expect(() => probeRegistry(JSON.stringify([{ ...probe, ...override }]))).toThrow();
  });
  it('requires consistent labels for a region and accepts an explicitly empty pilot scope', () => {
    expect(() => probeRegistry(JSON.stringify([{ ...probe, regionKey: guangzhou.key }, { ...probe, id: 'second', regionKey: guangzhou.key, region: 'other' }]))).toThrow('labels');
    expect(() => probeRegistry(JSON.stringify([{ ...probe, regionKey: guangzhou.key }, { ...probe, id: 'second', regionKey: chengdu.key }]))).toThrow('Duplicate');
    expect(probeRegistry(JSON.stringify([{ ...probe, nodeIds: [] }]))[0].nodeIds).toEqual([]);
  });
  it('bounds discovery and rotates it without exceeding approved CF ranges', () => {
    const a = discoverCandidates(CF_IP_RANGES, 'epoch-1', ['104.16.0.2', '192.0.2.1'], ['104.16.0.1']);
    expect(a[0]).toBe('104.16.0.1'); expect(a.length).toBeLessThanOrEqual(64);
    expect(a.every(ip => allowedByRanges(ip))).toBe(true);
    expect(a).not.toEqual(discoverCandidates(CF_IP_RANGES, 'epoch-2', [], []));
    expect(rangeList(CF_IP_RANGES.filter(r => !r.includes(':')).join('\n'), 4)).toHaveLength(15);
    expect(() => rangeList('0.0.0.0/0\n1.0.0.0/8\n2.0.0.0/8\n3.0.0.0/8\n4.0.0.0/8', 4)).toThrow();
    expect(allowedByRanges('104.16.0.1', ['172.64.0.0/13'])).toBe(false);
  });
  it.each([CreateSubscriptionDto, UpdateSubscriptionDto])('rejects null and strings in automatic mode', async Dto => {
    for (const cfAuto of [null, 'true', 1]) expect((await validate(Object.assign(new Dto(), { name: 'fixture', nodeIds: [], cfAuto }))).length).toBeGreaterThan(0);
  });
  it('caps remote responses and rejects failed HTTP before parsing', async () => {
    await expect(boundedText(new Response('a'.repeat(30)), 10)).rejects.toThrow('TOO_LARGE');
    await expect(boundedText(new Response('{}', { status: 500 }), 10)).rejects.toThrow('UNAVAILABLE');
  });
});

describe('candidate promotion, expiry and failover', () => {
  it('requires two recent successes before initial publication', () => {
    const first = updateObservations([], [{ ip: '104.16.0.1', ok: true, latency: 100 }], now);
    expect(rankCandidates(first, [], now)).toEqual([]);
    const next = updateObservations(first, [{ ip: '104.16.0.1', ok: true, latency: 80 }], now + 300_000);
    expect(rankCandidates(next, [], now + 300_000)).toHaveLength(1);
  });
  it('requires consecutive failures to evict and does not promote old results', () => {
    const old = [observation('104.16.0.1')];
    const one = updateObservations(old, [{ ip: old[0].ip, ok: false, latency: -1 }], now);
    expect(rankCandidates(one, old, now)).toHaveLength(1);
    expect(rankCandidates(updateObservations(one, [{ ip: old[0].ip, ok: false, latency: -1 }], now + 1), old, now + 1)).toHaveLength(0);
    expect(rankCandidates(old, old, now + FRESH_MS + 1)).toHaveLength(0);
  });
  it('does not churn a full pool for a tiny latency improvement', () => {
    const old = [observation('104.16.0.1'), observation('104.16.0.2'), observation('104.16.0.3')];
    expect(rankCandidates([...old, observation('104.16.0.4', 99)], old, now).map(o => o.ip)).not.toContain('104.16.0.4');
    expect(rankCandidates([...old, observation('104.16.0.4', 50)], old, now).map(o => o.ip)).toContain('104.16.0.4');
  });
  it('uses throughput only when samples are comparable and recent', () => {
    const slow = { ...observation('104.16.0.1', 50), bytesPerSecond: 1000, bandwidthAt: now };
    const fast = { ...observation('104.16.0.2', 100), bytesPerSecond: 2000, bandwidthAt: now };
    expect(rankCandidates([slow, fast], [], now)[0].ip).toBe(fast.ip);
    expect(rankCandidates([slow, { ...fast, bandwidthAt: now - 7 * 3600_000 }], [], now)[0].ip).toBe(slow.ip);
  });
  it('retains newly checked incumbents when the observation queue reaches its bound', () => {
    const old = Array.from({ length: 64 }, (_, i) => ({ ...observation(`104.16.0.${i + 1}`), checkedAt: now - 300_000 }));
    const updated = updateObservations(old, [{ ip: old[0].ip, ok: true, latency: 80 }, { ip: '104.17.0.1', ok: true, latency: 50 }], now);
    expect(updated).toHaveLength(64); expect(updated.map(o => o.ip)).toContain(old[0].ip);
    expect(updated.map(o => o.ip)).toContain('104.17.0.1');
  });
});

describe('one subscription, regional groups and dynamic providers', () => {
  const variants = automaticVariants(exported, node.id, [
    { region: guangzhou, ips: ['104.16.0.1'] }, { region: chengdu, ips: ['104.17.0.1'] }, { region: beijing, ips: ['104.18.0.1'] },
  ], '104.16.0.2');
  it('keeps origin identity separate from the dialed CF IP', () => {
    expect(variants).toHaveLength(4);
    for (const n of variants) {
      expect(n.domain).toBe(node.domain); expect(n.credentials.transportHost).toBe(node.domain);
      expect(n.credentials.uuid).toBe(exported.credentials.uuid); expect(allowedByRanges(n.host)).toBe(true);
    }
    expect(JSON.stringify(variants.map(({ server: _server, ...v }: any) => v))).not.toContain('192.0.2.1');
  });
  it('exports regional aliases and automatic selection instead of ordered fallback', () => {
    const config = buildClashSubscription(variants, 'https://panel.example.com');
    expect(config).toContain('广州云测优选'); expect(config).toContain('成都云测优选'); expect(config).toContain('北京云测优选');
    expect(config).not.toMatch(/电信优选|联通优选|移动优选/);
    expect(config).not.toContain('type: fallback'); expect(config).toContain('tolerance: 50');
    expect(config.slice(config.indexOf('proxy-groups:'), config.indexOf('  - name: 🚀'))).not.toContain('DIRECT');
  });
  it('uses scoped provider URLs, periodic refresh and a fail-closed empty group', () => {
    const config = buildClashSubscription(variants, 'https://panel.example.com', 'https://panel.example.com/api/subscriptions/share/shared-token/cf-provider');
    expect(config).toContain('/share/shared-token/cf-provider/node'); expect(config).not.toContain('/link/');
    expect(config).toContain('interval: 900'); expect(config).toContain('proxies: [REJECT]');
    expect(config).toContain('proxies: []'); expect(config).toContain('use: [cf-node]');
    expect(() => buildClashSubscription(variants, 'http://panel.example.com', 'http://panel.example.com/provider')).toThrow('HTTPS');
  });
  it.each([buildFullSingboxConfig, buildHomeProxyConfig])('exports all regions without direct selector fallback', builder => {
    const config = JSON.parse(builder(variants));
    const groups = config.outbounds.filter((o: any) => o.type === 'urltest' || o.type === 'selector');
    expect(groups.every((g: any) => !g.outbounds.includes('direct'))).toBe(true);
    expect(groups.some((g: any) => g.tag.includes('广州云测优选'))).toBe(true);
  });
  it('never invents measured carrier aliases from a generic cloud probe', () => {
    const generic = automaticVariants(exported, 'node', [{ ips: ['104.16.0.1'] }], '104.16.0.2');
    expect(generic.map(n => n.cfProfile)).toEqual(['GENERIC', 'DNS']);
    expect(generic.some(n => /电信|移动|联通/.test(n.name))).toBe(false);
  });
  it('retains generic fallback alongside partial regional coverage without DNS', () => {
    const mixed = automaticVariants(exported, 'node', [
      { region: guangzhou, ips: ['104.16.0.1'] }, { ips: ['104.17.0.1'] },
    ], null, [guangzhou, chengdu]);
    expect(mixed.map(n => n.cfProfile)).toEqual(['REGION:ap-guangzhou', 'GENERIC']);
    const config = buildClashSubscription(mixed, 'https://panel.example.com');
    expect(config).toContain(mixed[1].name);
    const singbox = JSON.parse(buildFullSingboxConfig(mixed));
    expect(singbox.outbounds.find((g: any) => g.tag.endsWith('成都云测优选')).outbounds).toEqual([mixed[1].name]);
  });
  it('keeps old cached carrier-era filters working until full subscription refresh', () => {
    for (const carrier of ['TELECOM', 'UNICOM', 'MOBILE']) {
      expect(variants.every(n => new RegExp(`\\[CF:(${carrier}|GENERIC|DNS)\\]$`).test(n.name))).toBe(true);
    }
  });
  it('ranks within each region by probe coverage and local ranks, not lowest remote latency', () => {
    const results = regionalCandidates([
      { region: guangzhou, observations: [observation('104.16.0.1', 200), observation('104.16.0.2', 300)] },
      { region: guangzhou, observations: [observation('104.16.0.3', 1), observation('104.16.0.1', 2)] },
      { region: chengdu, observations: [observation('104.16.0.4', 500)] },
    ], [guangzhou, chengdu]);
    expect(results[0].ips[0]).toBe('104.16.0.1');
    expect(results[1].ips).toEqual(['104.16.0.4']);
  });
});

describe('optimization service boundaries', () => {
  let service: CfOptimizationService; let db: any;
  const env = { ...process.env };
  beforeEach(() => {
    process.env.CF_OPTIMIZATION_PROBES = JSON.stringify([probe]);
    process.env.FIXTURE_CF_TOKEN = 'f'.repeat(32);
    db = { node: { findFirst: jest.fn(), findMany: jest.fn() },
      cfOptimization: { findMany: jest.fn().mockResolvedValue([]) },
      cfOptimizationState: { findUnique: jest.fn().mockResolvedValue(null) } };
    service = new CfOptimizationService(db, {} as any, {} as any);
  });
  afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });
  it('does no network or database work when the scheduled feature is disabled', async () => {
    delete process.env.CF_OPTIMIZATION_ENABLED;
    await service.tick(); expect(db.node.findMany).not.toHaveBeenCalled();
  });
  it('limits low-budget scheduling to two five-minute rounds every eight hours', async () => {
    process.env.CF_OPTIMIZATION_ENABLED = 'true'; process.env.CF_OPTIMIZATION_LOW_BUDGET = 'true';
    const sync = jest.spyOn(service, 'syncRanges').mockResolvedValue();
    db.node.findMany.mockResolvedValue([]);
    db.cfOptimizationState.deleteMany = jest.fn();
    const time = jest.spyOn(Date, 'now');
    for (const value of ['00:00', '00:05', '08:00', '08:05', '16:00', '16:05']) {
      time.mockReturnValue(Date.parse(`2026-10-31T${value}:00Z`)); await service.tick();
    }
    expect(sync).toHaveBeenCalledTimes(6);
    for (const value of ['00:10', '07:55', '08:10', '16:10', '23:55']) {
      time.mockReturnValue(Date.parse(`2026-10-31T${value}:00Z`)); await service.tick();
    }
    expect(sync).toHaveBeenCalledTimes(6);
  });
  it('confirms delayed low-budget jobs in the next slot without duplicate same-slot attempts', async () => {
    process.env.CF_OPTIMIZATION_ENABLED = 'true'; process.env.CF_OPTIMIZATION_LOW_BUDGET = 'true';
    const second = Date.parse('2026-10-31T08:05:00Z');
    jest.spyOn(Date, 'now').mockReturnValue(second);
    jest.spyOn(service, 'syncRanges').mockResolvedValue();
    const measure = jest.spyOn(service, 'measure').mockResolvedValue();
    db.node.findMany.mockResolvedValue([node, { ...node, id: 'delayed' }].map(n => ({ ...n,
      subscriptionNodes: [{ subscription: { ownerId: 'owner', cfOnly: true, cfProtectedNodeIds: [] } }] })));
    db.cfOptimization.findMany.mockResolvedValue([
      { nodeId: node.id, probeId: probe.id, attemptedAt: new Date(second - 300_000) },
      { nodeId: 'delayed', probeId: probe.id, attemptedAt: new Date(second - 210_000) },
    ]);
    db.cfOptimizationState.deleteMany = jest.fn();
    await service.tick();
    expect(measure).toHaveBeenCalledTimes(2);
    expect(measure).toHaveBeenCalledWith(expect.objectContaining({ id: 'delayed' }), probe);
    db.cfOptimization.findMany.mockResolvedValue([node.id, 'delayed'].map(nodeId =>
      ({ nodeId, probeId: probe.id, attemptedAt: new Date(second) })));
    await service.tick(); expect(measure).toHaveBeenCalledTimes(2);
  });
  it('checks ownership before returning measurements or rolling back', async () => {
    db.node.findFirst.mockResolvedValue(null);
    await expect(service.status('foreign', 'owner')).rejects.toThrow('Node not found');
    await expect(service.rollback('foreign', 'owner')).rejects.toThrow('Node not found');
    expect(db.cfOptimization.findMany).not.toHaveBeenCalled();
  });
  it('schedules a regional pilot only for its registered nodes at the configured interval', async () => {
    process.env.CF_OPTIMIZATION_ENABLED = 'true'; delete process.env.CF_OPTIMIZATION_LOW_BUDGET;
    process.env.CF_OPTIMIZATION_INTERVAL_MINUTES = '15';
    const pilot = { ...probe, id: 'chengdu', regionKey: chengdu.key, region: chengdu.label, nodeIds: ['node'] };
    process.env.CF_OPTIMIZATION_PROBES = JSON.stringify([pilot]);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(service, 'syncRanges').mockResolvedValue();
    const measure = jest.spyOn(service, 'measure').mockResolvedValue();
    db.node.findMany.mockResolvedValue([node, { ...node, id: 'not-in-pilot' }].map(n => ({ ...n,
      subscriptionNodes: [{ subscription: { ownerId: 'owner', cfOnly: true, cfProtectedNodeIds: [] } }] })));
    db.cfOptimizationState.deleteMany = jest.fn();
    await service.tick(); expect(measure).toHaveBeenCalledTimes(1);
    expect(measure).toHaveBeenCalledWith(expect.objectContaining({ id: 'node' }), pilot);
    for (const minutes of [5, 10]) { clock.mockReturnValue(now + minutes * 60_000); await service.tick(); }
    expect(measure).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 15 * 60_000); await service.tick(); expect(measure).toHaveBeenCalledTimes(2);
    process.env.CF_OPTIMIZATION_INTERVAL_MINUTES = '0'; await service.tick(); expect(measure).toHaveBeenCalledTimes(2);
  });
  it('reports regional freshness and shared quota without making a cloud request', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
    process.env.CF_OPTIMIZATION_LOW_BUDGET = 'true'; process.env.CF_OPTIMIZATION_MAX_MONTHLY_BATCHES = '200';
    const regional = { ...probe, regionKey: guangzhou.key, region: guangzhou.label };
    process.env.CF_OPTIMIZATION_PROBES = JSON.stringify([regional, { ...regional, id: 'chengdu', regionKey: chengdu.key, region: chengdu.label }]);
    const identity = fingerprint([nodeFingerprint(node), fingerprint([regional, fingerprint('f'.repeat(32))])]);
    db.node.findFirst.mockResolvedValue(node);
    db.cfOptimization.findMany.mockResolvedValue([{ probeId: probe.id, fingerprint: identity, checkedAt: new Date(now), published: [observation('104.16.0.1')] }]);
    db.cfOptimizationState.findUnique.mockImplementation(async ({ where }: any) => where.key === 'monthly:2026-10' ? { value: { batches: 24 } } : null);
    const remote = jest.spyOn(global, 'fetch');
    const result = await service.status(node.id, 'owner');
    expect(result.missingRegions).toEqual([chengdu.key]);
    expect(result.budget).toMatchObject({ used: 24, remaining: 176, estimatedMonthlyBatchesPerNode: 360, constrained: true });
    expect(result.profiles.map(p => p.regionKey)).toEqual([guangzhou.key, chengdu.key]);
    expect(remote).not.toHaveBeenCalled();
    db.cfOptimization.findMany.mockResolvedValue([{ probeId: probe.id, fingerprint: identity, checkedAt: new Date(now), published: [observation('192.0.2.1')] }]);
    expect((await service.status(node.id, 'owner')).missingRegions).toEqual([guangzhou.key, chengdu.key]);
  });
  it('schedules mixed protected CF nodes only, excluding ordinary and foreign nodes', async () => {
    process.env.CF_OPTIMIZATION_ENABLED = 'true'; delete process.env.CF_OPTIMIZATION_LOW_BUDGET;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(service, 'syncRanges').mockResolvedValue();
    const measure = jest.spyOn(service, 'measure').mockResolvedValue();
    db.cfOptimizationState.deleteMany = jest.fn();
    const member = { ...node, subscriptionNodes: [{ subscription: { ownerId: 'owner', cfOnly: false, cfProtectedNodeIds: ['node'] } }] };
    db.node.findMany.mockResolvedValue([member, { ...member, id: 'unprotected' }, { ...member, transport: 'TCP' }, { ...member, userId: 'foreign' }]);
    await service.tick();
    expect(measure).toHaveBeenCalledTimes(1); expect(measure).toHaveBeenCalledWith(member, probe);
    expect(db.node.findMany.mock.calls[0][0].where.subscriptionNodes.some.subscription).toEqual({ cfAuto: true });
  });
  it('uses default CF only without any valid measured snapshots', async () => {
    expect((await service.variants(exported, node, '104.16.0.2')).map(n => n.cfProfile)).toEqual(['DNS']);
    expect(await service.variants(exported, node, '192.0.2.1')).toEqual([]);
  });
  it('drops snapshots from old credentials, probe configurations or removed ranges', async () => {
    db.cfOptimization.findMany.mockResolvedValue([{ probeId: probe.id, fingerprint: 'old', checkedAt: new Date(), profile: 'REGION:ap-guangzhou', published: [observation('104.16.0.1')] }]);
    expect(await service.variants(exported, node, null)).toEqual([]);
    expect(nodeFingerprint(node)).not.toBe(nodeFingerprint({ ...node, credentialsEnc: 'rotated' }));
  });
  it('publishes only real configured probe identities and marks expired data generic', async () => {
    const time = Date.now();
    const regionalProbe = { ...probe, regionKey: guangzhou.key, region: guangzhou.label };
    process.env.CF_OPTIMIZATION_PROBES = JSON.stringify([regionalProbe]);
    const identity = fingerprint([nodeFingerprint(node), fingerprint([regionalProbe, fingerprint('f'.repeat(32))])]);
    db.cfOptimization.findMany.mockResolvedValue([{ probeId: probe.id, fingerprint: identity, checkedAt: new Date(time - FRESH_MS - 1), profile: 'REGION:ap-guangzhou',
      published: [{ ...observation('104.16.0.1'), checkedAt: time }] }]);
    expect((await service.variants(exported, node, null))[0].cfProfile).toBe('GENERIC');
    db.cfOptimization.findMany.mockResolvedValue([{ probeId: probe.id, fingerprint: identity, checkedAt: new Date(time - 25 * 3600_000), profile: 'REGION:ap-guangzhou',
      published: [{ ...observation('104.16.0.1'), checkedAt: time }] }]);
    expect(await service.variants(exported, node, null)).toEqual([]);
  });
  it('excludes out-of-scope probes and identity failures even with recently published records', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const identity = fingerprint([nodeFingerprint(node), fingerprint([probe, fingerprint('f'.repeat(32))])]);
    const row = { probeId: probe.id, fingerprint: identity, checkedAt: new Date(now), published: [observation('104.16.0.1')] };
    db.cfOptimization.findMany.mockResolvedValue([row]);
    expect((await service.variants(exported, node, null))[0].cfProfile).toBe('GENERIC');
    db.cfOptimization.findMany.mockResolvedValue([{ ...row, error: 'PROBE_IDENTITY_OR_CAPABILITY_MISMATCH' }]);
    expect(await service.variants(exported, node, null)).toEqual([]);
    process.env.CF_OPTIMIZATION_PROBES = JSON.stringify([{ ...probe, nodeIds: [] }]);
    db.cfOptimization.findMany.mockResolvedValue([row]);
    expect(await service.variants(exported, node, null)).toEqual([]);
  });
});

describe('probe to publication pipeline', () => {
  const env = { ...process.env };
  let service: CfOptimizationService; let db: any; let row: any; let states: Map<string, any>;
  let requests: any[]; let remote: jest.SpyInstance; let clock: jest.SpyInstance;
  beforeEach(() => {
    process.env.CF_OPTIMIZATION_PROBES = JSON.stringify([probe]);
    process.env.FIXTURE_CF_TOKEN = 'f'.repeat(32);
    row = undefined; states = new Map(); requests = [];
    clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    db = {
      node: { findUnique: jest.fn().mockResolvedValue(node) },
      cfOptimization: {
        findUnique: jest.fn(async () => row),
        upsert: jest.fn(async ({ create, update }) => { row = row ? { ...row, ...update } : { id: 'snapshot', ...create }; return row; }),
        create: jest.fn(async ({ data }) => { row = { id: 'snapshot', ...data }; return row; }),
        updateMany: jest.fn(async ({ data }) => { row = { ...row, ...data }; }),
      },
      cfOptimizationState: {
        findUnique: jest.fn(async ({ where }) => states.has(where.key) ? { value: states.get(where.key) } : null),
        upsert: jest.fn(async ({ create }) => { states.set(create.key, create.value); }),
        deleteMany: jest.fn(async ({ where }) => { states.delete(where.key); }),
      },
    };
    service = new CfOptimizationService(db, { getCredentials: jest.fn().mockResolvedValue(exported.credentials) } as any,
      { defaultIp: jest.fn().mockResolvedValue('104.16.0.1') } as any);
    remote = jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
      expect(options?.redirect).toBe('error');
      expect((options?.headers as Record<string, string>).Authorization).toBe(`Bearer ${'f'.repeat(32)}`);
      if (!options?.body) return new Response(JSON.stringify({ protocol: 2, probeId: probe.id, features: ['vless-ws-tls'] }));
      const body = JSON.parse(options.body as string); requests.push(body);
      return new Response(JSON.stringify({ protocol: 2, probeId: probe.id,
        results: body.ips.map((ip: string) => ({ ip, ok: true, latency: 100 })) }));
    });
  });
  afterEach(() => { process.env = { ...env }; jest.restoreAllMocks(); });
  async function rounds(count = 4) {
    for (let i = 0; i < count; i++) { clock.mockReturnValue(now + i * 300_000); await service.measure(node as any, probe); }
  }
  it('discovers, probes twice and publishes bounded safe aliases without origin or SSH data', async () => {
    await service.measure(node as any, probe);
    expect(row.published).toEqual([]);
    await rounds();
    expect(row.published.length).toBeGreaterThan(0); expect(row.published.length).toBeLessThanOrEqual(3);
    expect(row.published.every((o: any) => o.passed >= 2 && allowedByRanges(o.ip))).toBe(true);
    for (const body of requests) {
      expect(Object.keys(body).sort()).toEqual(['domain', 'downloadIps', 'ips', 'path', 'uuid']);
      expect(body.ips.length).toBeLessThanOrEqual(8); expect(body.domain).toBe(node.domain);
      expect(JSON.stringify(body)).not.toContain(node.server.ip);
    }
  });
  it('retains the last good pool and backs off when a worker is unavailable', async () => {
    await rounds();
    const before = JSON.stringify(row.published); const checked = row.checkedAt;
    remote.mockRejectedValue(new Error('secret remote error'));
    await service.measure(node as any, probe);
    expect(JSON.stringify(row.published)).toBe(before); expect(row.checkedAt).toEqual(checked);
    expect(row.error).toBe('PROBE_UNAVAILABLE');
    expect(states.get(`retry:${node.id}:${probe.id}`).failures).toBe(1);
    await service.measure(node as any, probe);
    expect(states.get(`retry:${node.id}:${probe.id}`).nextAt - Date.now()).toBe(600_000);
  });
  it('reserves a global monthly batch before capabilities and never refunds failed calls', async () => {
    process.env.CF_OPTIMIZATION_MAX_MONTHLY_BATCHES = '1';
    remote.mockImplementation(async () => {
      expect(states.get('monthly:2026-10')).toEqual({ batches: 1 });
      throw new Error('Unavailable');
    });
    await service.measure(node as any, probe);
    expect(remote).toHaveBeenCalledTimes(1);
    await service.measure({ ...node, id: 'second-node' } as any, { ...probe, id: 'second-probe' });
    expect(remote).toHaveBeenCalledTimes(1); expect(row.error).toBe('MONTHLY_BUDGET_EXHAUSTED');
    expect(states.get('retry:second-node:second-probe').nextAt).toBe(Date.parse('2026-11-01T00:00:00Z'));
    clock.mockReturnValue(Date.parse('2026-11-01T00:00:00Z'));
    await service.measure(node as any, probe);
    expect(states.get('monthly:2026-11')).toEqual({ batches: 1 });
    expect(remote).toHaveBeenCalledTimes(2);
  });
  it.each(['0', '-1', '1.5', 'NaN', '', '1e3', '1000001'])('fails closed before any cloud call with monthly limit %j', async limit => {
    process.env.CF_OPTIMIZATION_MAX_MONTHLY_BATCHES = limit;
    await service.measure(node as any, probe);
    expect(remote).not.toHaveBeenCalled();
    expect(row.error).toBe(limit === '0' ? 'MONTHLY_BUDGET_EXHAUSTED' : 'INVALID_MONTHLY_BUDGET');
  });
  it('defaults low-budget mode to 200 batches and blocks corrupted counters', async () => {
    process.env.CF_OPTIMIZATION_LOW_BUDGET = 'true';
    delete process.env.CF_OPTIMIZATION_MAX_MONTHLY_BATCHES;
    states.set('monthly:2026-10', { batches: 200 });
    await service.measure(node as any, probe);
    expect(remote).not.toHaveBeenCalled(); expect(row.error).toBe('MONTHLY_BUDGET_EXHAUSTED');
    states.set('monthly:2026-10', { batches: -1 });
    await service.measure(node as any, probe);
    expect(remote).not.toHaveBeenCalled(); expect(row.error).toBe('MONTHLY_BUDGET_UNAVAILABLE');
  });
  it('does not contact the cloud if durable budget reservation fails', async () => {
    process.env.CF_OPTIMIZATION_MAX_MONTHLY_BATCHES = '200';
    db.cfOptimizationState.upsert.mockRejectedValueOnce(new Error('Database unavailable'));
    await service.measure(node as any, probe);
    expect(remote).not.toHaveBeenCalled(); expect(row.error).toBe('MONTHLY_BUDGET_UNAVAILABLE');
  });
  it('does not publish results after node credentials change or the node is deleted', async () => {
    db.node.findUnique.mockResolvedValue({ ...node, credentialsEnc: 'rotated' });
    await service.measure(node as any, probe); expect(row).toBeUndefined();
    db.node.findUnique.mockResolvedValue(null);
    await service.measure(node as any, probe); expect(row).toBeUndefined();
  });
  it('rechecks probation candidates before a full queue can age out their first success', async () => {
    await service.measure(node as any, probe);
    row.observations = Array.from({ length: 64 }, (_, i) => ({ ...observation(`104.16.0.${i + 1}`), passed: i === 63 ? 1 : 0,
      checkedAt: i === 63 ? now : 0 }));
    clock.mockReturnValue(now + 300_000);
    await service.measure(node as any, probe);
    expect(requests.at(-1).ips).toContain('104.16.0.64');
    expect(row.published.map((o: any) => o.ip)).toContain('104.16.0.64');
  });
  it('rejects unsolicited or duplicate IP results rather than poisoning history', async () => {
    remote.mockResolvedValueOnce(new Response(JSON.stringify({ protocol: 2, probeId: probe.id, features: ['vless-ws-tls'] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ protocol: 2, probeId: probe.id,
        results: Array(8).fill({ ip: '127.0.0.1', ok: true, latency: 1 }) })));
    await service.measure(node as any, probe);
    expect(row.error).toBe('INVALID_PROBE_RESULT'); expect(row.published).toEqual([]);
  });
  it('keeps health checks running after download budget is exhausted and stops at request quota', async () => {
    states.set(`budget:${probe.id}:2026-10-31`, { bytes: 100 * 1024 * 1024, requests: 0 });
    await rounds(); expect(requests.every(r => r.downloadIps.length === 0)).toBe(true);
    states.set(`budget:${probe.id}:2026-10-31`, { bytes: 100 * 1024 * 1024, requests: 5000 });
    const count = requests.length;
    await service.measure(node as any, probe);
    expect(requests).toHaveLength(count); expect(row.error).toBe('DAILY_BUDGET_EXHAUSTED');
  });
  it('fails closed on mismatched probe identity and weak authentication configuration', async () => {
    remote.mockResolvedValue(new Response(JSON.stringify({ protocol: 2, probeId: 'other', features: ['vless-ws-tls'] })));
    await service.measure(node as any, probe); expect(row.error).toBe('PROBE_IDENTITY_OR_CAPABILITY_MISMATCH');
    expect(requests).toHaveLength(0);
    delete process.env.FIXTURE_CF_TOKEN; remote.mockClear();
    await service.measure(node as any, probe); expect(remote).not.toHaveBeenCalled();
  });
  it('requires the same cloud deployment region in capabilities and batch results', async () => {
    const regional = { ...probe, regionKey: chengdu.key, region: chengdu.label };
    let capabilityRegion = guangzhou.key; let batchRegion = chengdu.key;
    remote.mockImplementation(async (_url, options) => {
      if (!options?.body) return new Response(JSON.stringify({ protocol: 2, probeId: probe.id, features: ['vless-ws-tls'], regionKey: capabilityRegion, networkType: 'CLOUD' }));
      const body = JSON.parse(options.body); requests.push(body);
      return new Response(JSON.stringify({ protocol: 2, probeId: probe.id, regionKey: batchRegion, networkType: 'CLOUD',
        results: body.ips.map((ip: string) => ({ ip, ok: true, latency: 50 })) }));
    });
    await service.measure(node as any, regional);
    expect(row.error).toBe('PROBE_IDENTITY_OR_CAPABILITY_MISMATCH'); expect(requests).toHaveLength(0);
    capabilityRegion = chengdu.key; batchRegion = guangzhou.key;
    await service.measure(node as any, regional); expect(row.error).toBe('INVALID_PROBE_RESULT');
    batchRegion = chengdu.key;
    await service.measure(node as any, regional);
    clock.mockReturnValue(now + 15 * 60_000); await service.measure(node as any, regional);
    expect(row.profile).toBe('REGION:ap-chengdu'); expect(row.error).toBeNull(); expect(row.published.length).toBeGreaterThan(0);
  });
});
