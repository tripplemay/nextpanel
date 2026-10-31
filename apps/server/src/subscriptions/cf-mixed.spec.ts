import { CfAccessService } from './cf-access.service';
import { SubscriptionsService } from './subscriptions.service';
import { automaticVariants } from './cf-optimization.util';
import { buildCfUnavailableProvider } from './uri-builder';
import { CryptoService } from '../common/crypto/crypto.service';
import { sealExternalSecrets } from '../external-nodes/external-credentials';

const credentials = { uuid: '00000000-0000-4000-8000-000000000001', path: '/ws', password: 'fixture' };
const cfNode = { id: 'cf', userId: 'owner', name: 'CF node', protocol: 'VLESS', transport: 'WS', tls: 'TLS',
  listenPort: 443, domain: 'cdn.example.com', cfDnsRecordId: 'record', enabled: true, status: 'RUNNING', server: { ip: '192.0.2.90' } };
const ordinary = { ...cfNode, id: 'plain', name: 'Ordinary node', protocol: 'TROJAN', transport: 'TCP',
  cfDnsRecordId: null, domain: null, server: { ip: '192.0.2.91' } };
const cipher = new CryptoService({ getOrThrow: () => 'a'.repeat(64) } as any);
const external = { id: 'external', userId: 'owner', name: 'External node', protocol: 'TROJAN',
  address: '192.0.2.92', port: 443, tls: 'TLS', transport: 'TCP', sni: 'exit.example.com',
  credentialsEnc: sealExternalSecrets(cipher, 'owner', { password: 'fixture-external' }) };

describe('mixed subscriptions with per-node CDN protection', () => {
  let sub: any; let db: any; let cf: CfAccessService; let service: SubscriptionsService; let optimizer: any;
  beforeEach(() => {
    sub = { id: 'sub', name: 'mixed', ownerId: 'owner', token: 'owner-token', updatedAt: new Date(),
      cfOnly: false, cfAuto: true, cfPreferredIps: [], cfProtectedNodeIds: ['cf'],
      nodes: [{ nodeId: 'cf', node: { ...cfNode } }, { nodeId: 'plain', node: { ...ordinary } }],
      externalNodes: [{ externalNodeId: 'external', externalNode: external }] };
    db = {
      node: { findMany: jest.fn(async ({ where }) => sub.nodes.map((n: any) => n.node)
        .filter((n: any) => where.id.in.includes(n.id) && n.userId === where.userId)) },
      externalNode: { findMany: jest.fn().mockResolvedValue([external]) },
      subscription: { findUnique: jest.fn(async () => sub), findFirst: jest.fn(async () => sub),
        create: jest.fn(async ({ data }) => data), update: jest.fn(async ({ data }) => data) },
      subscriptionShare: { findUnique: jest.fn(async () => ({ subscription: sub })),
        findMany: jest.fn(async () => [{ shareToken: 'shared-token', subscription: sub }]) },
    };
    const nodes = { getCredentials: jest.fn().mockResolvedValue(credentials) };
    cf = new CfAccessService(db, nodes as any, {} as any);
    jest.spyOn(cf, 'defaultIp').mockResolvedValue('104.16.0.2');
    optimizer = { variants: jest.fn(async (exported, node, ip) => automaticVariants(exported, node.id, [], ip)) };
    service = new SubscriptionsService(db, nodes as any, { get: () => 'https://panel.example.com' } as any, cipher, cf, optimizer);
  });

  it('creates and updates mixed automatic subscriptions without changing ordinary/external selections', async () => {
    const created = await service.create('mixed', ['cf', 'plain'], 'owner', ['external'], { cfAuto: true });
    expect(created).toMatchObject({ cfOnly: false, cfAuto: true, cfProtectedNodeIds: ['cf'],
      nodes: { create: [{ nodeId: 'cf' }, { nodeId: 'plain' }] }, externalNodes: { create: [{ externalNodeId: 'external' }] } });
    sub.cfAuto = false; sub.cfProtectedNodeIds = [];
    const updated = await service.update('sub', undefined, undefined, 'owner', undefined, { cfAuto: true });
    expect(updated).toEqual({ cfAuto: true, cfProtectedNodeIds: ['cf'] });
    expect(db.subscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sub', updatedAt: sub.updatedAt } }));
  });
  it('keeps strict CF-only restrictions and rejects auto mode with no compatible or foreign nodes', async () => {
    await expect(service.create('strict', ['cf', 'plain'], 'owner', ['external'], { cfOnly: true, cfAuto: true })).rejects.toThrow('no external nodes');
    await expect(service.create('strict', ['cf', 'plain'], 'owner', [], { cfOnly: true })).rejects.toThrow('VLESS+WS+TLS');
    await expect(service.create('empty', ['plain'], 'owner', ['external'], { cfAuto: true })).rejects.toThrow('1-20 compatible');
    await expect(service.create('foreign', ['cf'], 'other-owner', [], { cfAuto: true })).rejects.toThrow('selection is not available');
    expect(db.subscription.create).not.toHaveBeenCalled();
  });
  it('bounds only CF nodes, not the total number of mixed managed nodes', async () => {
    sub.nodes.push(...Array.from({ length: 25 }, (_, i) => ({ node: { ...ordinary, id: `plain-${i}` } })));
    expect(await cf.automaticSelection(sub.nodes.map((n: any) => n.node.id), 'owner')).toEqual(['cf']);
    sub.nodes = Array.from({ length: 21 }, (_, i) => ({ node: { ...cfNode, id: `cf-${i}` } }));
    await expect(cf.automaticSelection(sub.nodes.map((n: any) => n.node.id), 'owner')).rejects.toThrow('1-20 compatible');
  });
  it.each(['generateContent', 'generateClashContent', 'generateSingboxContent', 'generateHomeProxyContent',
    'generateContentByShareToken', 'generateClashContentByShareToken', 'generateSingboxContentByShareToken', 'generateHomeProxyContentByShareToken'] as const)(
    'retains ordinary/external proxies but not the CF origin: %s', async method => {
      const output = await service[method]('token');
      const raw = typeof output === 'string' ? output : output.content;
      const text = /generateContent/.test(method) ? Buffer.from(raw, 'base64').toString() : raw;
      expect(text).toContain('192.0.2.91'); expect(text).toContain('192.0.2.92'); expect(text).not.toContain('192.0.2.90');
      if (!method.includes('Clash')) expect(text).toContain('104.16.0.2');
    });
  it('keeps non-CF URI bytes identical and ordinary names selectable in dynamic Clash', async () => {
    sub.cfAuto = false; sub.cfProtectedNodeIds = [];
    const before = Buffer.from(await service.generateContent('token'), 'base64').toString().split('\n').slice(1);
    sub.cfAuto = true; sub.cfProtectedNodeIds = ['cf'];
    const after = Buffer.from(await service.generateContent('token'), 'base64').toString().split('\n').slice(1);
    expect(after).toEqual(before);
    const yaml = (await service.generateClashContent('token')).content;
    const mainGroups = yaml.slice(yaml.indexOf('  - name: 🚀'), yaml.indexOf('\nrules:'));
    expect(mainGroups).toContain('Ordinary node'); expect(mainGroups).toContain('External node');
    const cfGroups = yaml.slice(yaml.indexOf('proxy-groups:'), yaml.indexOf('  - name: 🚀'));
    expect(cfGroups).not.toContain('Ordinary node'); expect(cfGroups).not.toContain('External node'); expect(cfGroups).not.toContain('DIRECT');
  });
  it('scopes providers to a protected owned node and excludes every external/ordinary proxy', async () => {
    const owner = await service.generateCfProvider({ token: 'owner-token' }, 'cf');
    expect(owner).toEqual(await service.generateCfProvider({ shareToken: 'shared-token' }, 'cf'));
    expect(owner).toContain('104.16.0.2'); expect(owner).not.toContain('192.0.2.9');
    expect(owner).not.toContain('fixture-external');
    await expect(service.generateCfProvider({ token: 'owner-token' }, 'plain')).rejects.toThrow('not available');
    sub.nodes[0].node.userId = 'foreign';
    await expect(service.generateCfProvider({ token: 'owner-token' }, 'cf')).rejects.toThrow('not available');
  });
  it.each(['dns', 'protocol', 'ownership', 'disabled'])(
    'omits unusable protected nodes without breaking other proxies or leaking origins: %s', async reason => {
      if (reason === 'dns') jest.spyOn(cf, 'defaultIp').mockResolvedValue(null);
      if (reason === 'protocol') sub.nodes[0].node.transport = 'TCP';
      if (reason === 'ownership') sub.nodes[0].node.userId = 'foreign';
      if (reason === 'disabled') sub.nodes[0].node.enabled = false;
      const content = Buffer.from(await service.generateContent('token'), 'base64').toString();
      expect(content).not.toContain('192.0.2.90'); expect(content).not.toContain('cdn.example.com');
      expect(content).toContain('192.0.2.91'); expect(content).toContain('192.0.2.92');
      if (reason !== 'ownership') expect(await service.generateCfProvider({ token: 'token' }, 'cf')).toBe(buildCfUnavailableProvider('cf'));
      sub.nodes = [sub.nodes[0]]; sub.externalNodes = [];
      await expect(service.generateClashContent('token')).rejects.toThrow('direct fallback is forbidden');
    });
  it('retains sticky protection when automatic mode is disabled and rejects stale scope writes', async () => {
    const updated = await service.update('sub', undefined, undefined, 'owner', undefined, { cfAuto: false });
    expect(updated).toEqual({ cfAuto: false });
    sub.cfAuto = false;
    const raw = Buffer.from(await service.generateContent('token'), 'base64').toString();
    expect(raw).toContain('104.16.0.2'); expect(raw).not.toContain('192.0.2.90');
    expect(optimizer.variants).not.toHaveBeenCalled();
    expect((await service.findSharedWith('viewer'))[0].nodes[0].node.server.ip).toBeUndefined();
    expect((await service.findSharedWith('viewer'))[0].nodes[1].node.server.ip).toBe('192.0.2.91');
  });
});
