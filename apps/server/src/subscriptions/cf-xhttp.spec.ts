import { cfXhttpCredentials, assertCfXhttpPilotEnabled } from '../nodes/protocols/cf-xhttp';
import { PROTOCOL_PRESETS, CREDENTIAL_GENERATORS } from '../nodes/protocols/presets';
import { generateXrayConfig } from '../nodes/config/xray-config';
import { buildXrayClientConfig } from '../nodes/xray-test/config-builder';
import { usageConfig } from '../usage/usage-config';
import { usageEligible, candidateKey } from '../usage/usage.util';
import { cfVariants, isCfManagedNode } from './cf-access.util';
import { buildClashProxy, buildShareUri, type NodeExportInfo } from './uri-builder';
import { clientProfile } from './client-profile';
import { SubscriptionsService } from './subscriptions.service';
import { automaticVariants } from './cf-optimization.util';

const credentials = { uuid: '00000000-0000-4000-8000-000000000001', path: '/pilot', xhttpMode: 'packet-up' };
const node = { id: 'pilot', userId: 'owner', name: 'CDN pilot', serverId: 'server', protocol: 'VLESS', implementation: 'XRAY',
  transport: 'XHTTP', tls: 'TLS', domain: 'cdn.example.com', cfDnsRecordId: 'record', listenPort: 443,
  status: 'RUNNING', enabled: true, statsPort: 20443, server: { ip: '192.0.2.90' } };
const exported = { ...node, host: node.domain, port: 443, credentials };

describe('bounded CDN XHTTP configuration', () => {
  it('requires an explicit deployment pilot gate', () => {
    const old = process.env.CF_XHTTP_PILOT_ENABLED;
    try {
      delete process.env.CF_XHTTP_PILOT_ENABLED;
      expect(() => assertCfXhttpPilotEnabled()).toThrow('disabled');
      process.env.CF_XHTTP_PILOT_ENABLED = 'true';
      expect(() => assertCfXhttpPilotEnabled()).not.toThrow();
    } finally { if (old === undefined) delete process.env.CF_XHTTP_PILOT_ENABLED; else process.env.CF_XHTTP_PILOT_ENABLED = old; }
  });
  it('has a TLS preset distinct from REALITY with fresh credentials', () => {
    expect(PROTOCOL_PRESETS.VLESS_XHTTP_TLS).toMatchObject({ protocol: 'VLESS', transport: 'XHTTP', tls: 'TLS', fixedPort: 443 });
    const first = CREDENTIAL_GENERATORS.VLESS_XHTTP_TLS();
    expect(first).not.toEqual(CREDENTIAL_GENERATORS.VLESS_XHTTP_TLS());
    expect(cfXhttpCredentials(first, node.domain).xhttpHost).toBe(node.domain);
    expect(first).not.toHaveProperty('realityPrivateKey');
  });
  it.each([{ xhttpExtra: '{"downloadSettings":{"address":"192.0.2.90"}}' }, { xhttpMode: 'auto' },
    { xhttpMode: 'stream-one' }, { xhttpHost: 'origin.example.com' }, { path: '/' }, { path: '/a\r\nb' }, { uuid: '' }])(
    'rejects unsupported or unsafe pilot options %j', override => {
      expect(() => cfXhttpCredentials({ ...credentials, ...override }, node.domain)).toThrow();
    });
  it('keeps both CDN and observation eligibility without treating REALITY as CDN', () => {
    expect(isCfManagedNode(node)).toBe(true); expect(usageEligible(node)).toBe(true);
    expect(isCfManagedNode({ ...node, tls: 'REALITY' })).toBe(false);
    expect(isCfManagedNode({ ...node, cfDnsRecordId: null })).toBe(false);
  });
  it('builds TLS/H2 server configuration without Vision and supports usage reconciliation', () => {
    const config = generateXrayConfig(node, credentials);
    const inbound = JSON.parse(config).inbounds.find((i: any) => i.tag === 'in-pilot');
    expect(inbound.settings.clients[0].flow).toBe('');
    expect(inbound.streamSettings).toMatchObject({ network: 'xhttp', security: 'tls',
      xhttpSettings: { host: node.domain, path: '/pilot', mode: 'packet-up' }, tlsSettings: { alpn: ['h2', 'http/1.1'] } });
    expect(inbound.streamSettings.realitySettings).toBeUndefined();
    const prepared = usageConfig(config, node.id, node.statsPort, []);
    expect(usageConfig(prepared.config, node.id, node.statsPort, []).prepared).toBe(true);
  });
  it('exports exactly the CF IP with pinned Host/SNI, H2 and verified TLS', () => {
    const candidate = cfVariants(exported, node.id, ['104.16.0.1'], null)[0];
    const uri = new URL(buildShareUri(candidate)!);
    expect(uri.hostname).toBe('104.16.0.1');
    expect(Object.fromEntries(uri.searchParams)).toMatchObject({ type: 'xhttp', security: 'tls', sni: node.domain, host: node.domain, mode: 'packet-up', alpn: 'h2' });
    const yaml = buildClashProxy(candidate)!;
    expect(yaml).toContain('alpn: [h2]'); expect(yaml).toContain('skip-cert-verify: false');
    expect(yaml).not.toContain('192.0.2.90'); expect(yaml).not.toContain('flow:');
    const config = JSON.parse(buildXrayClientConfig({ ...candidate, secureProbe: true }, 1080));
    expect(config.outbounds[0].streamSettings).toMatchObject({ network: 'xhttp',
      tlsSettings: { alpn: ['h2'], serverName: node.domain, allowInsecure: false }, xhttpSettings: { host: node.domain } });
    expect(candidateKey(candidate)).not.toBe(candidateKey({ ...candidate, transport: 'WS' }));
  });
  it('uses conservative explicit client profiles', () => {
    expect(clientProfile(undefined)).toBe('compatible'); expect(clientProfile('xhttp')).toBe('xhttp');
    for (const value of [null, '', 'latest', ['xhttp'], { value: 'xhttp' }]) expect(() => clientProfile(value)).toThrow();
  });
});

describe('CDN pilot export isolation', () => {
  let service: SubscriptionsService; let sub: any; let cf: any;
  beforeEach(() => {
    sub = { id: 'sub', name: 'Pilot', ownerId: 'owner', cfOnly: false, cfAuto: true, cfProtectedNodeIds: ['ws', 'pilot'],
      nodes: [{ node }, { node: { ...node, id: 'ws', name: 'Existing WS', transport: 'WS' } }], externalNodes: [] };
    const db = { subscription: { findUnique: jest.fn(async () => sub) },
      subscriptionShare: { findUnique: jest.fn(async () => ({ subscription: sub })) } };
    cf = { defaultIp: jest.fn().mockResolvedValue('104.16.0.1') };
    service = new SubscriptionsService(db as any, { getCredentials: async (_id: string, user: string) => {
      expect(user).toBe('owner'); return credentials;
    } } as any, { get: () => 'https://panel.example.com' } as any, {} as any, cf,
    { variants: async (info: NodeExportInfo, n: { id: string }, ip: string | null) => automaticVariants(info, n.id, [], ip) } as any);
  });
  it.each(['generateContent', 'generateContentByShareToken'] as const)('retains WS by default and explicitly opts in via %s', async method => {
    const decode = (s: string) => Buffer.from(s, 'base64').toString();
    const before = decode(await service[method]('token'));
    expect(before).toContain('type=ws'); expect(before).not.toContain('type=xhttp');
    const pilot = decode(await service[method]('token', 'xhttp'));
    expect(pilot).toContain('type=xhttp'); expect(pilot).toContain('type=ws'); expect(pilot).not.toContain(node.server.ip);
    expect(decode(await service[method]('token'))).toBe(before);
  });
  it.each(['generateClashContent', 'generateClashContentByShareToken'] as const)('isolates dynamic provider URLs in %s', async method => {
    expect((await service[method]('token')).content).not.toContain('cf-pilot:');
    const yaml = (await service[method]('token', 'xhttp')).content;
    expect(yaml).toContain('/cf-provider/pilot?profile=xhttp'); expect(yaml).toContain('empty-fallback: REJECT');
    expect(yaml.match(/ {4}use: \[cf-/g)).toHaveLength(2);
  });
  it('cannot bypass profile isolation through a direct provider request', async () => {
    for (const by of [{ token: 'token' }, { shareToken: 'token' }]) {
      expect(await service.generateCfProvider(by, 'pilot')).not.toContain('network: xhttp');
      expect(await service.generateCfProvider(by, 'pilot', 'xhttp')).toContain('network: xhttp');
    }
  });
  it('exports mapped nodes on CF 443 only and withdraws stale mappings', async () => {
    const mapping = { version: 1, zoneId: 'zone', ref: `np_origin_${'a'.repeat(32)}`, domain: node.domain, port: 8443,
      state: 'READY', rulesetId: 'set', ruleId: 'rule', checkedAt: new Date().toISOString() };
    sub.nodes[0] = { node: { ...node, listenPort: 8443, publicPort: 443, cfOriginRoute: mapping } };
    const content = Buffer.from(await service.generateContent('token', 'xhttp'), 'base64').toString();
    expect(content).toContain(':443?'); expect(content).not.toContain(':8443');
    const provider = await service.generateCfProvider({ token: 'token' }, 'pilot', 'xhttp');
    expect(provider).toContain('port: 443'); expect(provider).not.toContain('8443');
    mapping.checkedAt = new Date(Date.now() - 21 * 60_000).toISOString();
    const empty = await service.generateCfProvider({ token: 'token' }, 'pilot', 'xhttp');
    expect(empty).not.toContain('network: xhttp'); expect(empty).not.toContain(node.server.ip);
    const ws = Buffer.from(await service.generateContent('token'), 'base64').toString();
    expect(ws).toContain('type=ws'); expect(ws).not.toContain('type=xhttp');
  });
  it('does not resolve an excluded pilot domain on compatibility downloads', async () => {
    sub.nodes[0] = { node: { ...node, domain: 'pilot.example.com' } };
    await service.generateContent('token');
    expect(cf.defaultIp).toHaveBeenCalledWith(node.domain);
    expect(cf.defaultIp).not.toHaveBeenCalledWith('pilot.example.com');
    await service.generateContent('token', 'xhttp');
    expect(cf.defaultIp).toHaveBeenCalledWith('pilot.example.com');
  });
  it('never exports a DNS hostname/origin even without subscription CF switches', async () => {
    sub.cfAuto = false; sub.cfProtectedNodeIds = []; sub.nodes = [{ node }];
    expect(Buffer.from(await service.generateContent('token', 'xhttp'), 'base64').toString()).toContain('@104.16.0.1:443');
    cf.defaultIp.mockResolvedValue(null);
    await expect(service.generateContent('token', 'xhttp')).rejects.toThrow('direct fallback is forbidden');
  });
  it('fails closed for a pure pilot requested by an unverified client or sing-box', async () => {
    sub.nodes = [{ node }];
    await expect(service.generateClashContent('token')).rejects.toThrow('direct fallback is forbidden');
    await expect(service.generateSingboxContent('token')).rejects.toThrow('direct fallback is forbidden');
    await expect(service.generateHomeProxyContent('token')).rejects.toThrow('direct fallback is forbidden');
  });
  it('keeps the WS path for sing-box and HomeProxy in mixed subscriptions', async () => {
    for (const method of ['generateSingboxContent', 'generateHomeProxyContent'] as const) {
      const raw = await service[method]('token');
      expect(raw).toContain('"type": "ws"'); expect(raw).not.toContain('xhttp'); expect(raw).not.toContain(node.server.ip);
    }
  });
  it('prepares both transports for owner/share observation without changing default exports', async () => {
    const db = { subscription: { findUniqueOrThrow: jest.fn().mockResolvedValue({ token: 'owner-token', shares: [{ shareToken: 'share-token' }] }) } };
    const usage = { setEnabled: jest.fn().mockResolvedValue({ enabled: true }) };
    const preparing = new SubscriptionsService(db as any, {} as any, {} as any, {} as any, {} as any, undefined, usage as any);
    const fetch = jest.spyOn(preparing as any, 'fetchActiveNodes').mockResolvedValue([]);
    await preparing.setUsage('sub', 'owner', true);
    expect(fetch).toHaveBeenCalledWith({ token: 'owner-token' }, undefined, 'xhttp');
    expect(fetch).toHaveBeenCalledWith({ shareToken: 'share-token' }, undefined, 'xhttp');
    expect((await service.generateClashContent('token')).content).not.toContain('cf-pilot:');
  });
});
