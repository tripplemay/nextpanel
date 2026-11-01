import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { CfAccessService } from './cf-access.service';
import { CfOptimizationService } from './cf-optimization.service';
import { automaticVariants } from './cf-optimization.util';

describe('client-aware subscription HTTP export', () => {
  let app: INestApplication, base: string;
  const node = { id: 'pilot', userId: 'owner', name: 'CDN XHTTP', enabled: true, status: 'RUNNING',
    protocol: 'VLESS', transport: 'XHTTP', tls: 'TLS', domain: 'cdn.example.com', cfDnsRecordId: 'record',
    listenPort: 443, server: { ip: '192.0.2.99' } };
  const sub = { id: 'sub', name: 'Fixture', ownerId: 'owner', cfAuto: true, cfOnly: false, cfProtectedNodeIds: ['ws'],
    nodes: [{ node }, { node: { ...node, id: 'ws', name: 'Existing WS', transport: 'WS' } }], externalNodes: [] };
  const db = { subscription: { findUnique: jest.fn(async ({ where }) => where.token === 'owner-token' ? sub : null) },
    subscriptionShare: { findUnique: jest.fn(async ({ where }) => where.shareToken === 'share-token' ? { subscription: sub } : null) } };
  const cf = { defaultIp: jest.fn().mockResolvedValue('104.16.0.3') };
  const regions = [{ key: 'ap-guangzhou', label: 'Guangzhou' }, { key: 'ap-chengdu', label: 'Chengdu' }];
  const optimizer = { variants: async (info: any, n: { id: string }, ip: string) => automaticVariants(info, n.id,
    regions.map((region, i) => ({ region, ips: [`104.16.0.${i + 1}`] })), ip, regions) };
  beforeAll(async () => {
    const service = new SubscriptionsService(db as any, { getCredentials: async (_id: string, owner: string) => {
      expect(owner).toBe('owner');
      return { uuid: '00000000-0000-4000-8000-000000000001', path: '/test', xhttpMode: 'packet-up' };
    } } as any, { get: () => 'https://panel.example.com' } as any, {} as any, cf as any, optimizer as any);
    const module = await Test.createTestingModule({ controllers: [SubscriptionsController], providers: [
      { provide: SubscriptionsService, useValue: service }, { provide: CfAccessService, useValue: cf },
      { provide: CfOptimizationService, useValue: optimizer },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });
  const request = (path: string, ua = 'Shadowrocket/3488 CFNetwork/fixture Darwin/fixture') => fetch(`${base}/subscriptions/${path}`, {
    headers: { 'User-Agent': ua },
  });
  it.each(['link/owner-token', 'share/share-token'])('adds safe XHTTP paths without replacing the original %s URL', async path => {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('User-Agent');
    const raw = Buffer.from(await response.text(), 'base64').toString();
    const lines = raw.split('\n').map(line => new URL(line));
    const xhttp = lines.filter(u => u.searchParams.get('type') === 'xhttp');
    expect(xhttp).toHaveLength(3);
    expect(lines.some(u => u.searchParams.get('type') === 'ws')).toBe(true);
    for (const u of xhttp) {
      expect(['104.16.0.1', '104.16.0.2', '104.16.0.3']).toContain(u.hostname);
      expect(u.port).toBe('443');
      expect(Object.fromEntries(u.searchParams)).toMatchObject({ host: node.domain, sni: node.domain, security: 'tls', type: 'xhttp', mode: 'packet-up', alpn: 'h2' });
    }
    expect(raw).not.toContain(node.server.ip);
    const rollback = Buffer.from(await (await request(path + '?profile=compatible')).text(), 'base64').toString();
    expect(rollback).toContain('type=ws'); expect(rollback).not.toContain('type=xhttp');
    expect(Buffer.from(await (await request(path, 'unknown')).text(), 'base64').toString()).toBe(rollback);
  });
  it.each(['link/owner-token', 'share/share-token'])('pins provider capability independently of download agent in %s', async path => {
    const response = await request(path + '/clash', 'clash.meta/alpha-gbc76c13');
    expect(response.status).toBe(200);
    const content = await response.text();
    expect(content).toContain('/cf-provider/pilot?profile=xhttp');
    expect(content).toContain('empty-fallback: REJECT');
    const provider = await request(path + '/cf-provider/pilot?profile=xhttp', 'different-downloader');
    expect(provider.status).toBe(200);
    const yaml = await provider.text();
    expect(yaml.match(/network: xhttp/g)).toHaveLength(3);
    expect(yaml).not.toContain(node.server.ip);
    const rollback = await request(path + '/cf-provider/pilot?profile=compatible');
    expect(await rollback.text()).not.toContain('network: xhttp');
  });
  it('never uses a client hint as token authorization', async () => {
    for (const path of ['link/missing', 'share/missing']) expect((await request(path)).status).toBe(404);
  });
  it.each(['link/owner-token', 'share/share-token'])('retains WS for unsupported structured clients in %s', async path => {
    for (const format of ['singbox', 'homeproxy']) {
      const response = await request(`${path}/${format}?profile=xhttp`);
      expect(response.status).toBe(200);
      const raw = await response.text();
      expect(raw).toContain('"type": "ws"');
      expect(raw).not.toContain('xhttp'); expect(raw).not.toContain(node.server.ip);
    }
  });
  it('fails closed when the original URL has no supported nodes', async () => {
    const before = sub.nodes; sub.nodes = [{ node }];
    try {
      expect((await request('link/owner-token', 'unknown')).status).toBe(503);
      expect((await request('link/owner-token', 'Shadowrocket/3488')).status).toBe(200);
      cf.defaultIp.mockResolvedValueOnce(null);
      const oldVariants = optimizer.variants; optimizer.variants = async () => [];
      try { expect((await request('share/share-token')).status).toBe(503); }
      finally { optimizer.variants = oldVariants; }
    } finally { sub.nodes = before; }
  });
});
