import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma.service';
import { NodesService } from '../nodes/nodes.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  subscription: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
} as unknown as PrismaService;

const mockNodes = {
  getCredentials: jest.fn(),
} as unknown as NodesService;

const mockConfig = { get: jest.fn((key: string) => key === 'PANEL_URL' ? 'http://localhost:3001' : undefined) } as unknown as import('@nestjs/config').ConfigService;
const svc = new SubscriptionsService(mockPrisma, mockNodes, mockConfig);

beforeEach(() => jest.clearAllMocks());

// ── URI builders (via generateContent) ───────────────────────────────────────

interface MockSub {
  token: string;
  nodes: Array<{ node: {
    id: string; name: string; protocol: string;
    listenPort: number; enabled: boolean; status: string;
    domain: string | null; server: { ip: string };
  }}>;
}

function makeSubWithNode(protocol: string, _creds: Record<string, string>): MockSub {
  return {
    token: 'tok',
    nodes: [{
      node: {
        id: 'n1',
        name: 'My Node',
        protocol,
        listenPort: 8080,
        enabled: true,
        status: 'RUNNING',
        domain: null,
        server: { ip: '1.2.3.4' },
      },
    }],
  };
}

describe('SubscriptionsService – generateContent', () => {
  it('throws NotFoundException for unknown token', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(svc.generateContent('bad-token')).rejects.toThrow(NotFoundException);
  });

  it('returns base64-encoded content', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(makeSubWithNode('VLESS', {}));
    (mockNodes.getCredentials as jest.Mock).mockResolvedValue({ uuid: 'test-uuid' });

    const result = await svc.generateContent('tok');
    expect(() => Buffer.from(result, 'base64')).not.toThrow();
  });

  it('skips disabled nodes', async () => {
    const sub = makeSubWithNode('VMESS', {});
    sub.nodes[0].node.enabled = false;
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(sub);

    const result = await svc.generateContent('tok');
    expect(Buffer.from(result, 'base64').toString()).toBe('');
  });

  it('skips non-RUNNING nodes', async () => {
    const sub = makeSubWithNode('VMESS', {});
    sub.nodes[0].node.status = 'STOPPED';
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(sub);

    const result = await svc.generateContent('tok');
    expect(Buffer.from(result, 'base64').toString()).toBe('');
  });

  it.each([
    ['VMESS', { uuid: 'u1' }, 'vmess://'],
    ['VLESS', { uuid: 'u2' }, 'vless://'],
    ['TROJAN', { password: 'p1' }, 'trojan://'],
    ['SHADOWSOCKS', { method: 'aes-256-gcm', password: 'pw' }, 'ss://'],
    ['SOCKS5', {}, 'socks5://'],
    ['HTTP', {}, 'http://'],
  ])('generates %s URI', async (protocol, creds, prefix) => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(makeSubWithNode(protocol, {}));
    (mockNodes.getCredentials as jest.Mock).mockResolvedValue(creds);

    const result = await svc.generateContent('tok');
    const decoded = Buffer.from(result, 'base64').toString();
    expect(decoded).toContain(prefix);
  });

  it('uses domain as host when domain is set (CDN node connects via domain)', async () => {
    const sub = makeSubWithNode('VLESS', {});
    sub.nodes[0].node.domain = 'cdn.example.com';
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(sub);
    (mockNodes.getCredentials as jest.Mock).mockResolvedValue({ uuid: 'u1' });

    const result = await svc.generateContent('tok');
    const decoded = Buffer.from(result, 'base64').toString();
    expect(decoded).toContain('cdn.example.com');
    expect(decoded).not.toContain('1.2.3.4');
  });
});

// ── Clash content generation ───────────────────────────────────────────────────

describe('SubscriptionsService – generateClashContent', () => {
  it('throws NotFoundException for unknown token', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(svc.generateClashContent('bad-token')).rejects.toThrow(NotFoundException);
  });

  it('returns empty YAML when subscription has no active nodes', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue({ token: 'tok', name: 'My Sub', nodes: [] });
    const result = await svc.generateClashContent('tok');
    expect(result.content).toContain('proxies: []');
    expect(result.content).toContain('MATCH,');
    expect(result.name).toBe('My Sub');
  });

  it('returns YAML with proxies block for active VLESS node', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(makeSubWithNode('VLESS', {}));
    (mockNodes.getCredentials as jest.Mock).mockResolvedValue({ uuid: 'test-uuid' });
    const result = await svc.generateClashContent('tok');
    expect(result.content).toContain('proxies:');
    expect(result.content).toContain('type: vless');
    expect(result.content).toContain('proxy-groups:');
    expect(result.content).toContain('🚀 节点选择');
  });

  it('includes node name in proxy-groups selector', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(makeSubWithNode('VMESS', {}));
    (mockNodes.getCredentials as jest.Mock).mockResolvedValue({ uuid: 'u1' });
    const result = await svc.generateClashContent('tok');
    expect(result.content).toContain('My Node');
  });
});

// ── Sing-box content generation ────────────────────────────────────────────────

describe('SubscriptionsService – generateSingboxContent', () => {
  it('throws NotFoundException for unknown token', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(svc.generateSingboxContent('bad-token')).rejects.toThrow(NotFoundException);
  });

  it('returns valid JSON with selector outbound', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(makeSubWithNode('VLESS', {}));
    (mockNodes.getCredentials as jest.Mock).mockResolvedValue({ uuid: 'test-uuid' });
    const result = await svc.generateSingboxContent('tok');
    const parsed = JSON.parse(result) as { outbounds: Array<{ type: string; tag: string; default?: string }> };
    const selector = parsed.outbounds.find((o) => o.type === 'selector');
    expect(selector).toBeDefined();
    expect(selector!.tag).toBe('🚀 节点选择');
  });

  it('uses "direct" fallback when no active nodes', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue({ token: 'tok', nodes: [] });
    const result = await svc.generateSingboxContent('tok');
    const parsed = JSON.parse(result) as { outbounds: Array<{ type: string; default?: string }> };
    const selector = parsed.outbounds.find((o) => o.type === 'selector');
    expect(selector!.default).toBe('direct');
  });

  it('includes node outbound when active node is present', async () => {
    (mockPrisma.subscription.findUnique as jest.Mock).mockResolvedValue(makeSubWithNode('TROJAN', {}));
    (mockNodes.getCredentials as jest.Mock).mockResolvedValue({ password: 'secret' });
    const result = await svc.generateSingboxContent('tok');
    const parsed = JSON.parse(result) as { outbounds: Array<{ type: string }> };
    const trojan = parsed.outbounds.find((o) => o.type === 'trojan');
    expect(trojan).toBeDefined();
  });
});

// ── CRUD ──────────────────────────────────────────────────────────────────────

describe('SubscriptionsService – CRUD', () => {
  it('update throws NotFoundException when subscription not found', async () => {
    (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.update('bad-id', 'New Name', undefined, 'owner-1')).rejects.toThrow(NotFoundException);
  });

  it('update renames subscription when name is provided', async () => {
    const fakeSub = { id: 'sub-1', ownerId: 'owner-1' };
    (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(fakeSub);
    (mockPrisma.subscription.update as jest.Mock).mockResolvedValue(fakeSub);

    await svc.update('sub-1', 'Renamed', undefined, 'owner-1');

    const call = (mockPrisma.subscription.update as jest.Mock).mock.calls[0][0];
    expect(call.data.name).toBe('Renamed');
    expect(call.data.nodes).toBeUndefined();
  });

  it('update replaces nodes when nodeIds is provided', async () => {
    const fakeSub = { id: 'sub-1', ownerId: 'owner-1' };
    (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(fakeSub);
    (mockPrisma.subscription.update as jest.Mock).mockResolvedValue(fakeSub);

    await svc.update('sub-1', undefined, ['n1', 'n2'], 'owner-1');

    const call = (mockPrisma.subscription.update as jest.Mock).mock.calls[0][0];
    expect(call.data.nodes.create).toHaveLength(2);
  });

  it('refreshToken throws NotFoundException when subscription not found', async () => {
    (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.refreshToken('bad-id', 'owner-1')).rejects.toThrow(NotFoundException);
  });

  it('refreshToken updates token and returns it', async () => {
    const fakeSub = { id: 'sub-1', ownerId: 'owner-1' };
    (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(fakeSub);
    (mockPrisma.subscription.update as jest.Mock).mockResolvedValue({ id: 'sub-1', token: 'new-token' });

    const result = await svc.refreshToken('sub-1', 'owner-1');
    expect(result).toMatchObject({ token: 'new-token' });
  });

  it('create calls prisma with correct data', async () => {
    (mockPrisma.subscription.create as jest.Mock).mockResolvedValue({ id: 'sub-1' });
    await svc.create('My Sub', ['n1', 'n2'], 'owner-1');
    const call = (mockPrisma.subscription.create as jest.Mock).mock.calls[0][0];
    expect(call.data.name).toBe('My Sub');
    expect(call.data.ownerId).toBe('owner-1');
    expect(call.data.nodes.create).toHaveLength(2);
  });

  it('findAll filters by ownerId', async () => {
    (mockPrisma.subscription.findMany as jest.Mock).mockResolvedValue([]);
    await svc.findAll('owner-1');
    expect((mockPrisma.subscription.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ ownerId: 'owner-1' });
  });

  it('remove throws NotFoundException when subscription does not exist', async () => {
    (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(svc.remove('bad-id', 'user-id-1')).rejects.toThrow(NotFoundException);
  });

  it('remove deletes and returns result when subscription exists', async () => {
    const fakeSub = { id: 'sub-1' };
    (mockPrisma.subscription.findFirst as jest.Mock).mockResolvedValue(fakeSub);
    (mockPrisma.subscription.delete as jest.Mock).mockResolvedValue(fakeSub);
    const result = await svc.remove('sub-1', 'user-id-1');
    expect(result).toBe(fakeSub);
  });
});
