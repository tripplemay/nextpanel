import { SubscriptionsService } from './subscriptions.service';
import { ExternalNodesService } from '../external-nodes/external-nodes.service';
import { importedTransportHost, parseUri } from '../external-nodes/uri-parser';
import { buildClashProxy, buildSingboxOutbound, NodeExportInfo } from './uri-builder';
import { buildXrayClientConfig } from '../nodes/xray-test/config-builder';

describe('subscription security and import/export round trips', () => {
  const db = {
    externalNode: { createMany: jest.fn() },
    subscription: { findUnique: jest.fn() },
    subscriptionShare: { findMany: jest.fn(), findUnique: jest.fn() },
  };
  const service = new SubscriptionsService(db as any, {} as any, {} as any);
  const importer = new ExternalNodesService(db as any, {} as any, {} as any, {} as any);
  beforeEach(() => jest.resetAllMocks());

  it('never sends the owner token to a recipient', async () => {
    db.subscriptionShare.findMany.mockResolvedValue([{ shareToken: 'recipient-token', subscription: {
      id: 'sub-1', name: 'share', ownerId: 'owner', token: 'OWNER-SECRET',
      createdAt: new Date(), updatedAt: new Date(), nodes: [], externalNodes: [],
    } }]);
    const shared = await service.findSharedWith('viewer');
    expect(shared[0]).toHaveProperty('shareToken', 'recipient-token');
    expect(shared[0]).not.toHaveProperty('token');
    expect(shared[0]).not.toHaveProperty('ownerId');
    expect(JSON.stringify(shared)).not.toContain('OWNER-SECRET');
    expect(db.subscriptionShare.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'viewer' } }));
  });
  it('revoked share tokens cannot fall back to an owner-token lookup', async () => {
    db.subscriptionShare.findUnique.mockResolvedValue(null);
    await expect(service.generateContentByShareToken('revoked')).rejects.toThrow('Share not found');
    expect(db.subscription.findUnique).not.toHaveBeenCalled();
  });

  const ws = 'vless://uuid@proxy.test:443?type=ws&security=tls&sni=tls.test&host=ws.test&path=%2Fcustom%3Fed%3D2048#WS';
  const grpc = 'trojan://p%40ss%3Aword@proxy.test:443?type=grpc&security=tls&sni=tls.test&serviceName=custom-grpc#GRPC';
  const http = 'https://user%40name:p%3Ass%40word@proxy.test:8443#HTTPS';
  const vmess = 'vmess://' + Buffer.from(JSON.stringify({ add: 'proxy.test', port: 443, id: 'uuid', net: 'ws', tls: 'tls', host: 'ws.test', sni: 'tls.test', path: '/custom?ed=2048', ps: 'VMess' })).toString('base64');

  it('recovers legacy WS Host from rawUri without confusing it with SNI', () => {
    expect(importedTransportHost({ transportHost: null, rawUri: ws })).toBe('ws.test');
    expect(importedTransportHost({ transportHost: 'explicit.test', rawUri: ws })).toBe('explicit.test');
    expect(importedTransportHost({ rawUri: 'malformed' })).toBeUndefined();
  });

  it.each([ws, grpc, http, vmess])('preserves connection parameters through import, storage and URI export: %s', async (uri) => {
    let stored: any;
    db.externalNode.createMany.mockImplementation(async ({ data }) => { stored = data[0]; return { count: 1 }; });
    await importer.import('owner', uri);
    db.subscription.findUnique.mockResolvedValue({ ownerId: 'owner', nodes: [], externalNodes: [{ externalNode: stored }] });
    const encoded = await service.generateContent('owner-token');
    const exported = parseUri(Buffer.from(encoded, 'base64').toString('utf8'));
    const original = parseUri(uri)!;
    for (const field of ['protocol', 'address', 'port', 'uuid', 'username', 'password', 'transport', 'transportHost', 'tls', 'sni', 'path'] as const) {
      expect(exported?.[field] ?? '').toEqual(original[field] ?? '');
    }
  });

  function info(uri: string): NodeExportInfo {
    const n = parseUri(uri)!;
    const credentials = Object.fromEntries(Object.entries(n).filter(([key, value]) =>
      ['path', 'transportHost', 'uuid', 'username', 'password'].includes(key) && typeof value === 'string'));
    return { name: n.name, protocol: n.protocol, host: n.address, port: n.port,
      transport: n.transport ?? null, tls: n.tls, domain: n.sni ?? null, credentials: credentials as Record<string, string> };
  }
  it('uses the same WS path, Host and SNI in Clash, sing-box and Xray tests', () => {
    const node = info(ws);
    const clash = buildClashProxy(node)!;
    expect(clash).toContain('path: "/custom?ed=2048"');
    expect(clash).toContain('Host: ws.test');
    expect(clash).toContain('servername: tls.test');
    expect(buildSingboxOutbound(node)).toMatchObject({ transport: { type: 'ws', path: '/custom?ed=2048', headers: { Host: 'ws.test' } }, tls: { server_name: 'tls.test' } });
    expect(JSON.parse(buildXrayClientConfig(node, 1080)).outbounds[0].streamSettings).toMatchObject({
      wsSettings: { path: '/custom?ed=2048', headers: { Host: 'ws.test' } }, tlsSettings: { serverName: 'tls.test' },
    });
  });
  it('preserves gRPC service names in every structured output', () => {
    const node = info(grpc);
    expect(buildClashProxy(node)).toContain('grpc-service-name: custom-grpc');
    expect(buildSingboxOutbound(node)).toMatchObject({ transport: { service_name: 'custom-grpc' } });
    expect(JSON.parse(buildXrayClientConfig(node, 1080)).outbounds[0].streamSettings.grpcSettings.serviceName).toBe('custom-grpc');
  });
  it('does not silently downgrade authenticated HTTPS proxies', () => {
    const node = info(http);
    expect(buildClashProxy(node)).toContain('tls: true');
    expect(buildSingboxOutbound(node)).toMatchObject({ tls: { enabled: true, server_name: 'proxy.test' }, username: 'user@name', password: 'p:ss@word' });
    expect(JSON.parse(buildXrayClientConfig(node, 1080)).outbounds[0].streamSettings.security).toBe('tls');
  });
});
