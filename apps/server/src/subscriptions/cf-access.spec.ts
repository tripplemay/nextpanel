import { validate } from 'class-validator';
import { CfAccessService } from './cf-access.service';
import { assertCfManagedNode, cfVariants, isCloudflareIp, normalizeCfPreferredIps } from './cf-access.util';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { CheckCfAccessDto } from './dto/check-cf-access.dto';
import { buildXrayClientConfig } from '../nodes/xray-test/config-builder';
import { buildClashSubscription, buildFullSingboxConfig, buildHomeProxyConfig } from './uri-builder';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const node = {
  id: 'n1', userId: 'owner', name: 'Telecom', protocol: 'VLESS', implementation: 'XRAY', transport: 'WS', tls: 'TLS',
  listenPort: 443, domain: 'cdn.example.com', cfDnsRecordId: 'record', server: { ip: '192.0.2.10' },
  enabled: true, status: 'RUNNING', exitType: 'MANAGED_SERVER', exitServer: { ip: '192.0.2.11' },
};
const credentials = { uuid: 'test-uuid', path: '/ws?ed=2048', transportHost: 'stale.example.com' };
const preferred = ['104.16.0.1', '2606:4700::1111'];

describe('CF endpoint variants native config checks (no network probes)', () => {
  const variants = cfVariants({ ...node, host: node.domain, port: 443,
    credentials: { uuid: '00000000-0000-4000-8000-000000000001', path: '/ws' } }, node.id, preferred, '104.16.0.2');
  const nativeCheck = (binary: string, input: string, args: (directory: string, config: string) => string[]) => {
    const directory = mkdtempSync(join(tmpdir(), 'np-cf-native-'));
    try {
      const config = join(directory, input.trimStart().startsWith('{') ? 'config.json' : 'config.yaml');
      writeFileSync(config, input, { mode: 0o600 });
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ENABLE_DEPRECATED_')));
      const result = spawnSync(binary, args(directory, config), { encoding: 'utf8', env, timeout: 15000 });
      if (result.status !== 0) throw new Error(`Native check failed: ${result.error?.message ?? ''}\n${result.stdout}${result.stderr}`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  };
  const singboxIt = spawnSync('sing-box', ['version']).status === 0 ? it : it.skip;
  singboxIt.each([['sing-box', buildFullSingboxConfig], ['HomeProxy', buildHomeProxyConfig]] as const)('%s validates full CF config', (_label, builder) => {
    nativeCheck('sing-box', builder(variants), (_directory, config) => ['check', '-c', config]);
  });
  const xrayIt = spawnSync('xray', ['version']).status === 0 ? it : it.skip;
  xrayIt('Xray validates the exact CF test/export identity', () => {
    nativeCheck('xray', buildXrayClientConfig(variants[1], 1080), (_directory, config) => ['run', '-test', '-c', config]);
  });
  const mihomo = process.env.MIHOMO_BINARY ?? (process.platform === 'darwin' ? '/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo' : 'mihomo');
  const mihomoIt = spawnSync(mihomo, ['-v']).status === 0 ? it : it.skip;
  mihomoIt('Mihomo validates exported proxies and fallback groups without downloading rule/GeoIP databases', () => {
    const full = buildClashSubscription(variants, 'https://panel.example.com');
    const proxySections = full.slice(full.indexOf('\nproxies:'), full.indexOf('\nrules:'));
    nativeCheck(mihomo, `mode: rule\n${proxySections}\nrules:\n  - MATCH,${variants[0].cfGroup}\n`,
      (directory, config) => ['-t', '-d', directory, '-f', config]);
  });
});

describe('CF endpoint validation', () => {
  it.each(['104.16.0.1', '172.64.0.1', '2606:4700::1111'])('allows CF addresses: %s', (ip) => {
    expect(isCloudflareIp(ip)).toBe(true);
  });
  it.each(['1.1.1.1', '192.0.2.10', '127.0.0.1', '169.254.169.254', '10.0.0.1', '::1',
    '::ffff:104.16.0.1', '0:0:0:0:0:ffff:6810:1', '104.16.0.1:443', 'cdn.example.com', 'https://104.16.0.1', '104.16.0.1\n',
    '2606:4700::1%lo0', '104.32.0.1'])('rejects non-literal or non-CF addresses: %s', (ip) => {
    expect(isCloudflareIp(ip)).toBe(false);
    expect(() => normalizeCfPreferredIps([ip])).toThrow();
  });
  it('bounds, canonicalizes and deduplicates candidates', () => {
    expect(normalizeCfPreferredIps([])).toEqual([]);
    expect(normalizeCfPreferredIps(['2606:4700:0:0:0:0:0:1111'])).toEqual(['2606:4700::1111']);
    expect(() => normalizeCfPreferredIps(['2606:4700::1111', '2606:4700:0:0:0:0:0:1111'])).toThrow('Duplicate');
    expect(() => normalizeCfPreferredIps(Array(4).fill('104.16.0.1'))).toThrow('at most 3');
    expect(() => normalizeCfPreferredIps(null)).toThrow();
  });
  it.each([
    { protocol: 'ANYTLS' }, { transport: 'TCP' }, { tls: 'REALITY' }, { listenPort: 8443 },
    { domain: null }, { domain: 'localhost' }, { domain: '192.0.2.10' }, { cfDnsRecordId: null },
  ])('rejects ineligible nodes %j', (override) => {
    expect(() => assertCfManagedNode({ ...node, ...override })).toThrow();
  });
  it.each([CreateSubscriptionDto, UpdateSubscriptionDto])('rejects null and malformed new DTO fields', async (Dto) => {
    const base = { name: 'fixture', nodeIds: ['n1'] };
    expect(await validate(Object.assign(new Dto(), base, { cfOnly: true, cfPreferredIps: preferred }))).toHaveLength(0);
    for (const value of [{ cfOnly: null }, { cfOnly: 'true' }, { cfPreferredIps: null },
      { cfPreferredIps: ['example.com'] }, { cfPreferredIps: Array(4).fill('104.16.0.1') }]) {
      expect((await validate(Object.assign(new Dto(), base, value))).length).toBeGreaterThan(0);
    }
  });
  it('validates the check request', async () => {
    expect((await validate(Object.assign(new CheckCfAccessDto(), { nodeId: '', ip: 'example.com' }))).length).toBeGreaterThan(0);
  });
});

describe('CF DNS pinning, bounded checks and audit', () => {
  let cf: CfAccessService;
  let db: any;
  let nodes: any;
  let xray: any;
  let resolver: any;
  beforeEach(() => {
    db = { node: { findFirst: jest.fn().mockResolvedValue(node), findMany: jest.fn().mockResolvedValue([node]) } };
    nodes = { getCredentials: jest.fn().mockResolvedValue(credentials) };
    xray = { testWithParams: jest.fn().mockResolvedValue({ reachable: true, latency: 50, message: 'OK', testedAt: '2026-10-31' }) };
    cf = new CfAccessService(db, nodes, xray);
    resolver = (cf as any).resolver;
    resolver.resolve4 = jest.fn().mockResolvedValue([{ address: '104.16.0.2', ttl: 60 }]);
    resolver.resolve6 = jest.fn().mockResolvedValue([]);
  });
  it('pins only CF DNS answers and coalesces repeated requests', async () => {
    const first = cf.defaultIp(node.domain);
    const second = cf.defaultIp(node.domain);
    expect(await first).toBe('104.16.0.2');
    expect(await second).toBe('104.16.0.2');
    expect(await cf.defaultIp(node.domain)).toBe('104.16.0.2');
    expect(resolver.resolve4).toHaveBeenCalledTimes(1);
  });
  it('honors DNS TTL and rejects a subsequent gray-cloud answer', async () => {
    resolver.resolve4.mockResolvedValueOnce([{ address: '104.16.0.2', ttl: 0 }]).mockResolvedValue([{ address: '192.0.2.10', ttl: 60 }]);
    expect(await cf.defaultIp(node.domain)).toBe('104.16.0.2');
    expect(await cf.defaultIp(node.domain)).toBeNull();
  });
  it('rejects mixed IPv4/IPv6 answers rather than exporting an unsafe hostname', async () => {
    resolver.resolve6.mockResolvedValue([{ address: '::1', ttl: 60 }]);
    expect(await cf.defaultIp(node.domain)).toBeNull();
  });
  it('fails closed when DNS fails', async () => {
    resolver.resolve4.mockRejectedValue(new Error('timeout'));
    resolver.resolve6.mockRejectedValue(new Error('timeout'));
    expect(await cf.defaultIp(node.domain)).toBeNull();
    await expect(cf.check('n1', 'owner')).resolves.toMatchObject({ reachable: false, address: null,
      audit: { findings: expect.arrayContaining(['DEFAULT_DNS_NOT_CF_OR_UNAVAILABLE']) } });
    expect(xray.testWithParams).not.toHaveBeenCalled();
  });
  it('checks the exact candidate, preserves TLS/WS identity and labels the vantage', async () => {
    db.node.findFirst.mockResolvedValueOnce({ ...node, exitType: null, exitServer: null }).mockResolvedValueOnce({ id: 'direct' });
    const result = await cf.check('n1', 'owner', preferred[0]);
    expect(db.node.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: 'n1', userId: 'owner' } }));
    expect(xray.testWithParams).toHaveBeenCalledWith(expect.objectContaining({
      host: preferred[0], domain: node.domain, secureProbe: true,
      credentials: { ...credentials, transportHost: node.domain },
    }));
    expect(result).toMatchObject({ address: preferred[0], vantage: 'PANEL', audit: { status: 'UNVERIFIED' } });
    expect(result.audit.findings).toContain('ENTRY_IS_EXIT');
    expect(result.audit.findings).toContain('OTHER_DIRECT_NODE_ON_ENTRY');
    expect(JSON.stringify(result)).not.toContain(node.server.ip);
    expect(JSON.stringify(result)).not.toContain(credentials.uuid);
    expect(JSON.stringify(result)).not.toContain('credentials');
  });
  it('does not claim source hiding is verified for a separate exit', async () => {
    db.node.findFirst.mockResolvedValueOnce(node).mockResolvedValueOnce(null);
    expect((await cf.check('n1', 'owner')).audit).toEqual({ status: 'UNVERIFIED', findings: ['DNS_HISTORY_AND_FIREWALL_UNVERIFIED'] });
  });
  it('denies foreign/missing nodes before testing', async () => {
    db.node.findFirst.mockResolvedValue(null);
    await expect(cf.check('foreign', 'owner', preferred[0])).rejects.toThrow('Node not found');
    expect(xray.testWithParams).not.toHaveBeenCalled();
    expect(nodes.getCredentials).not.toHaveBeenCalled();
  });
  it('rejects unsafe probes before any IO', async () => {
    await expect(cf.check('n1', 'owner', '127.0.0.1')).rejects.toThrow();
    expect(db.node.findFirst).not.toHaveBeenCalled();
  });
  it('allows only one concurrent check per owner and releases the slot', async () => {
    let release!: (value: any) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    xray.testWithParams.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; markStarted(); }));
    const first = cf.check('n1', 'owner', preferred[0]);
    await expect(cf.check('n1', 'owner', preferred[0])).rejects.toThrow('already running');
    await started;
    release({ reachable: true });
    await first;
    await expect(cf.check('n1', 'owner', preferred[0])).resolves.toHaveProperty('vantage', 'PANEL');
  });
  it('restricts selections to owned managed CF nodes', async () => {
    await cf.validateSelection(['n1'], [], 'owner');
    expect(db.node.findMany).toHaveBeenCalledWith({ where: { id: { in: ['n1'] }, userId: 'owner' } });
    await expect(cf.validateSelection([], [], 'owner')).rejects.toThrow();
    await expect(cf.validateSelection(['n1'], ['external'], 'owner')).rejects.toThrow();
    db.node.findMany.mockResolvedValue([]);
    await expect(cf.validateSelection(['foreign'], [], 'owner')).rejects.toThrow();
  });
});

describe('CF-only subscriptions', () => {
  let sub: any;
  let db: any;
  let cf: any;
  let svc: SubscriptionsService;
  beforeEach(() => {
    sub = { id: 's1', name: 'Telecom', ownerId: 'owner', cfOnly: true, cfPreferredIps: preferred,
      nodes: [{ nodeId: 'n1', node }], externalNodes: [] };
    db = {
      node: { findMany: jest.fn().mockResolvedValue([node]) },
      subscription: { findUnique: jest.fn().mockImplementation(async () => sub), findFirst: jest.fn().mockImplementation(async () => sub), update: jest.fn(), create: jest.fn() },
      subscriptionShare: { findUnique: jest.fn().mockImplementation(async () => ({ subscription: sub })), findMany: jest.fn() },
    };
    cf = { defaultIp: jest.fn().mockResolvedValue('104.16.0.2'), validateSelection: jest.fn() };
    svc = new SubscriptionsService(db, { getCredentials: async () => credentials } as any,
      { get: () => 'https://panel.example.com' } as any, {} as any, cf);
  });
  const exporters = ['generateContent', 'generateClashContent', 'generateSingboxContent', 'generateHomeProxyContent',
    'generateContentByShareToken', 'generateClashContentByShareToken', 'generateSingboxContentByShareToken', 'generateHomeProxyContentByShareToken'] as const;
  it.each(exporters)('rejects zero active nodes without DIRECT output: %s', async (method) => {
    sub.nodes = [];
    await expect(svc[method]('token')).rejects.toThrow('direct fallback is forbidden');
  });
  it.each(exporters)('does not output origin IPs: %s', async (method) => {
    const output = await svc[method]('token');
    const raw = typeof output === 'string' ? output : output.content;
    const text = method === 'generateContent' || method === 'generateContentByShareToken' ? Buffer.from(raw, 'base64').toString() : raw;
    expect(text).not.toContain(node.server.ip);
    expect(text).not.toContain(node.exitServer.ip);
    expect(text).toContain('104.16.0.1');
    expect(text).toContain('2606:4700::1111');
    expect(text).toContain(node.domain);
    expect(text).not.toContain('stale.example.com');
    expect(text).not.toContain('skip-cert-verify: true');
    expect(text).not.toContain('"insecure": true');
  });
  it('retains credentials, path, port, SNI and WS Host in URI variants', async () => {
    const uris = Buffer.from(await svc.generateContent('token'), 'base64').toString().split('\n').map((uri) => new URL(uri));
    expect(uris).toHaveLength(3);
    for (const uri of uris) {
      expect(uri.port).toBe('443');
      expect(uri.username).toBe(credentials.uuid);
      expect(uri.searchParams.get('sni')).toBe(node.domain);
      expect(uri.searchParams.get('host')).toBe(node.domain);
      expect(uri.searchParams.get('path')).toBe(credentials.path);
    }
  });
  it('exports ordered Mihomo fallback groups with no direct member', async () => {
    const { content } = await svc.generateClashContent('token');
    const group = content.slice(content.indexOf('proxy-groups:'), content.indexOf('  - name: 🚀'));
    expect(group).toContain('type: fallback');
    expect(group).toContain('https://www.gstatic.com/generate_204');
    expect(group.indexOf('P1')).toBeLessThan(group.indexOf('P2'));
    expect(group.indexOf('P2')).toBeLessThan(group.indexOf('DNS'));
    expect(group).not.toContain('DIRECT');
  });
  it.each(['generateSingboxContent', 'generateHomeProxyContent'] as const)('keeps proxy selectors/urltests CF-only: %s', async (method) => {
    const config = JSON.parse(await svc[method]('token'));
    const groups = config.outbounds.filter((o: any) => ['selector', 'urltest'].includes(o.type));
    expect(groups.every((g: any) => !g.outbounds.includes('direct'))).toBe(true);
    expect(groups.find((g: any) => g.tag.endsWith('[CF n1]'))).toMatchObject({ type: 'urltest', interrupt_exist_connections: false });
    const proxies = config.outbounds.filter((o: any) => o.type === 'vless');
    expect(proxies).toHaveLength(3);
    expect(proxies[0]).toMatchObject({ server: preferred[0], tls: { server_name: node.domain }, transport: { headers: { Host: node.domain } } });
  });
  it('keeps owner/share exports identical', async () => {
    expect(await svc.generateContent('owner')).toBe(await svc.generateContentByShareToken('share'));
    expect(await svc.generateClashContent('owner')).toEqual(await svc.generateClashContentByShareToken('share'));
    expect(await svc.generateSingboxContent('owner')).toEqual(await svc.generateSingboxContentByShareToken('share'));
    expect(await svc.generateHomeProxyContent('owner')).toEqual(await svc.generateHomeProxyContentByShareToken('share'));
  });
  it('omits unsafe/failed default DNS but keeps literal CF candidates', async () => {
    cf.defaultIp.mockResolvedValue(null);
    expect(Buffer.from(await svc.generateContent('token'), 'base64').toString().split('\n')).toHaveLength(2);
    sub.cfPreferredIps = [];
    await expect(svc.generateContent('token')).rejects.toThrow('direct fallback is forbidden');
  });
  it('supports safe rollback by clearing candidates while retaining CF-only and tokens', async () => {
    await svc.update('s1', undefined, undefined, 'owner', undefined, { cfPreferredIps: [] });
    expect(db.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: { cfPreferredIps: [] } }));
    await expect(svc.update('s1', undefined, undefined, 'owner', undefined, { cfOnly: false })).rejects.toThrow('cannot be disabled');
  });
  it('guards a stale legacy-mode write against a concurrent CF-only enable', async () => {
    sub.cfOnly = false;
    sub.cfPreferredIps = [];
    await svc.update('s1', undefined, undefined, 'owner', undefined, { cfOnly: false });
    expect(db.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1', cfOnly: false } }));
  });
  it('rejects incompatible or external nodes after a configuration drift', async () => {
    sub.nodes = [{ node: { ...node, transport: 'TCP' } }];
    await expect(svc.generateContent('token')).rejects.toThrow('managed VLESS+WS+TLS');
    sub.nodes = [{ node }];
    sub.externalNodes = [{ externalNode: {} }];
    await expect(svc.generateContent('token')).rejects.toThrow('selection is invalid');
  });
  it('redacts origin IPs from the shared viewer response', async () => {
    db.subscriptionShare.findMany.mockResolvedValue([{ shareToken: 'share', subscription: sub }]);
    const result = JSON.stringify(await svc.findSharedWith('viewer'));
    expect(result).not.toContain(node.server.ip);
  });
  it('validates selection before persisting an opt-in subscription', async () => {
    await svc.create('Telecom', ['n1'], 'owner', [], { cfOnly: true, cfPreferredIps: preferred });
    expect(cf.validateSelection).toHaveBeenCalledWith(['n1'], [], 'owner');
    expect(db.subscription.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cfOnly: true, cfPreferredIps: preferred }) }));
  });
  it('cannot silently accept preferred IPs in legacy mode', async () => {
    await expect(svc.create('bad', ['n1'], 'owner', [], { cfPreferredIps: preferred })).rejects.toThrow('require CF-only');
    expect(db.subscription.create).not.toHaveBeenCalled();
  });
  it('does not duplicate a preferred address that equals the default', () => {
    const variants = cfVariants({ ...node, host: node.domain, port: 443, credentials }, node.id, [preferred[0]], preferred[0]);
    expect(variants).toHaveLength(1);
    const config = JSON.parse(buildXrayClientConfig(variants[0], 1080));
    expect(config.outbounds[0]).toMatchObject({ settings: { vnext: [{ address: preferred[0], port: 443 }] },
      streamSettings: { tlsSettings: { serverName: node.domain }, wsSettings: { headers: { Host: node.domain } } } });
  });
});
