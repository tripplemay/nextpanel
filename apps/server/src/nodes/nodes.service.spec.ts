import { NodesService } from './nodes.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from './node-deploy.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CreateNodeDto } from './dto/create-node.dto';

jest.mock('../common/database/advisory-lock', () => ({
  withPostgresAdvisoryLocks: (_keys: string[], work: () => Promise<unknown>) => work(),
}));

const mockPrisma = {
  $transaction: jest.fn(async (work: (tx: { $queryRawUnsafe: jest.Mock }) => unknown) =>
    work({ $queryRawUnsafe: jest.fn().mockResolvedValue([]) }),
  ),
  node: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  server: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
} as unknown as PrismaService;

const mockCrypto = {
  encrypt: jest.fn((s: string) => `enc:${s}`),
  decrypt: jest.fn((s: string) => s.replace('enc:', '')),
} as unknown as CryptoService;

const mockDeploy = {
  deploy: jest.fn().mockResolvedValue({ success: true, log: '' }),
  undeploy: jest.fn().mockResolvedValue(undefined),
  toggleService: jest.fn().mockResolvedValue(undefined),
} as unknown as NodeDeployService;

const mockCfService = {
  createARecord: jest.fn().mockResolvedValue('cf-record-id'),
  deleteRecord: jest.fn().mockResolvedValue(undefined),
} as unknown as CloudflareService;

const mockCfSettings = {
  getDecryptedToken: jest.fn().mockResolvedValue(null),
  verify: jest.fn().mockResolvedValue({ valid: true, zoneStatus: 'active' }),
} as unknown as CloudflareSettingsService;

const svc = new NodesService(mockPrisma, mockCrypto, mockDeploy, mockCfService, mockCfSettings);

const fakeNode = {
  id: 'node-1', serverId: 'srv-1', name: 'Test Node',
  protocol: 'VMESS', implementation: 'XRAY', transport: 'TCP',
  tls: 'NONE', listenPort: 10086, domain: null,
  status: 'RUNNING', enabled: true, createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (mockDeploy.deploy as jest.Mock).mockResolvedValue({ success: true, log: '' });
  (mockDeploy.undeploy as jest.Mock).mockResolvedValue(undefined);
  (mockDeploy.toggleService as jest.Mock).mockResolvedValue(undefined);
  (mockCfService.createARecord as jest.Mock).mockResolvedValue('cf-record-id');
  (mockCfService.deleteRecord as jest.Mock).mockResolvedValue(undefined);
  (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue(null);
  (mockCfSettings.verify as jest.Mock).mockResolvedValue({ valid: true, zoneStatus: 'active' });
  (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);
  (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue({ id: 'srv-1' });
  (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);
});

describe('NodesService', () => {
  describe('create', () => {
    it('rejects a server that does not belong to the current user', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.create({
        serverId: 'other-server',
        name: 'Unauthorized',
        protocol: 'VMESS',
        listenPort: 10086,
        credentials: { uuid: 'abc' },
      } as any, 'user-id-1')).rejects.toThrow('Server other-server not found');

      expect(mockPrisma.node.create).not.toHaveBeenCalled();
      expect(mockDeploy.deploy).not.toHaveBeenCalled();
    });

    it('rejects creation when deletion starts before the locked re-check', async () => {
      (mockPrisma.server.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'srv-1', status: 'ONLINE' })
        .mockResolvedValueOnce({ id: 'srv-1', status: 'DELETING' });

      await expect(svc.create({
        serverId: 'srv-1',
        name: 'Too late',
        protocol: 'VMESS',
        implementation: 'XRAY',
        transport: 'TCP',
        tls: 'NONE',
        listenPort: 10086,
        credentials: { uuid: 'abc' },
      } as any, 'user-id-1')).rejects.toThrow('服务器正在删除');

      expect(mockPrisma.node.create).not.toHaveBeenCalled();
      expect(mockDeploy.deploy).not.toHaveBeenCalled();
    });

    it('encrypts credentials and triggers deploy', async () => {
      (mockPrisma.node.create as jest.Mock).mockResolvedValue(fakeNode);
      const dto: CreateNodeDto = {
        serverId: 'srv-1', name: 'Test', protocol: 'VMESS' as any,
        implementation: 'XRAY' as any, transport: 'TCP' as any, tls: 'NONE' as any,
        listenPort: 10086, credentials: { uuid: 'abc' }, enabled: true,
      };
      await svc.create(dto, 'user-id-1');
      expect(mockCrypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ uuid: 'abc' }));
      // deploy is fire-and-forget; just verify it was called
      expect(mockDeploy.deploy).toHaveBeenCalledWith('node-1');
    });

    it('defaults enabled to true when not provided', async () => {
      (mockPrisma.node.create as jest.Mock).mockResolvedValue(fakeNode);
      const dto = { serverId: 's', name: 'N', protocol: 'VMESS', listenPort: 80, credentials: {} } as any;
      await svc.create(dto, 'user-id-1');
      const data = (mockPrisma.node.create as jest.Mock).mock.calls[0][0].data;
      expect(data.enabled).toBe(true);
    });

    it('defaults tls to NONE when not provided', async () => {
      (mockPrisma.node.create as jest.Mock).mockResolvedValue(fakeNode);
      const dto = { serverId: 's', name: 'N', protocol: 'VMESS', listenPort: 80, credentials: {} } as any;
      await svc.create(dto, 'user-id-1');
      const data = (mockPrisma.node.create as jest.Mock).mock.calls[0][0].data;
      expect(data.tls).toBe('NONE');
    });

    it('defaults the full VLESS XHTTP REALITY shape and credentials', async () => {
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-xhttp' });

      await svc.create({
        serverId: 'srv-1',
        name: 'XHTTP',
        protocol: 'VLESS',
        transport: 'XHTTP',
        listenPort: 443,
        credentials: {},
      } as any, 'user-id-1');

      const data = (mockPrisma.node.create as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({
        protocol: 'VLESS', implementation: 'XRAY', transport: 'XHTTP', tls: 'REALITY',
        listenPort: 443,
      });
      const credentials = JSON.parse(
        (mockCrypto.encrypt as jest.Mock).mock.calls[0][0],
      ) as Record<string, string>;
      expect(credentials.uuid).toMatch(/^[0-9a-f-]{36}$/i);
      expect(credentials.realityPrivateKey).toBeTruthy();
      expect(credentials.realityPublicKey).toBeTruthy();
      expect(credentials.shortId).toMatch(/^[0-9a-f]{16}$/);
      expect(credentials.path).toMatch(/^\/[A-Za-z0-9_-]+$/);
    });

    it('rejects VLESS XHTTP on a non-standard port', async () => {
      await expect(svc.create({
        serverId: 'srv-1', name: 'XHTTP', protocol: 'VLESS', transport: 'XHTTP',
        listenPort: 8443, credentials: {},
      } as any, 'user-id-1')).rejects.toThrow('必须监听 443 端口');
      expect(mockPrisma.node.create).not.toHaveBeenCalled();
    });

    it.each([
      [{ id: 'existing', listenPort: 443, statsPort: null, implementation: 'SING_BOX' }, 443],
      [{ id: 'existing', listenPort: 2443, statsPort: 20443, implementation: 'XRAY' }, 20443],
    ])('rejects a manual node whose listen/stats port conflicts', async (existing, conflict) => {
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([{
        ...existing,
        serverId: 'srv-1',
        exitServerId: null,
        exitPort: null,
      }]);
      await expect(svc.create({
        serverId: 'srv-1', name: 'Manual', protocol: 'VMESS', implementation: 'XRAY',
        listenPort: 443, credentials: {},
      } as any, 'user-id-1')).rejects.toThrow(`服务器端口 ${conflict}`);
      expect(mockPrisma.node.create).not.toHaveBeenCalled();
    });

    it('rejects XHTTP on a non-VLESS protocol', async () => {
      await expect(svc.create({
        serverId: 'srv-1', name: 'Bad XHTTP', protocol: 'VMESS', transport: 'XHTTP',
        listenPort: 11000, credentials: {},
      } as any, 'user-id-1')).rejects.toThrow('XHTTP 传输仅支持 VLESS 协议');
      expect(mockPrisma.node.create).not.toHaveBeenCalled();
    });

    it('rejects removed Xray QUIC transport with a migration hint', async () => {
      await expect(svc.create({
        serverId: 'srv-1', name: 'Legacy QUIC', protocol: 'VLESS', transport: 'QUIC',
        listenPort: 1443, credentials: {},
      } as any, 'user-id-1')).rejects.toThrow('迁移到 VLESS + XHTTP + REALITY 或 TUIC v5');
      expect(mockPrisma.node.create).not.toHaveBeenCalled();
    });

    it('creates manual TUIC with managed DNS and generated credentials', async () => {
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-tuic' });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-tuic' });

      await svc.create({
        serverId: 'srv-1', name: 'TUIC', protocol: 'TUIC', listenPort: 16000, credentials: {},
      } as any, 'user-id-1');

      const data = (mockPrisma.node.create as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({
        protocol: 'TUIC', implementation: 'SING_BOX', transport: null, tls: 'TLS',
        domain: null, source: 'AUTO',
      });
      const credentials = JSON.parse(
        (mockCrypto.encrypt as jest.Mock).mock.calls[0][0],
      ) as Record<string, string>;
      expect(credentials.uuid).toMatch(/^[0-9a-f-]{36}$/i);
      expect(credentials.password).toHaveLength(32);
      expect(mockCfService.createARecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', expect.stringContaining('example.com'), '1.2.3.4', false,
      );
    });

    it('rolls back a manual AnyTLS node when managed DNS creation fails', async () => {
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-anytls' });
      (mockPrisma.node.delete as jest.Mock).mockResolvedValue({});
      (mockCfService.createARecord as jest.Mock).mockRejectedValue(new Error('dns failed'));

      await expect(svc.create({
        serverId: 'srv-1', name: 'AnyTLS', protocol: 'ANYTLS', listenPort: 17000, credentials: {},
      } as any, 'user-id-1')).rejects.toThrow('dns failed');

      expect(mockPrisma.node.delete).toHaveBeenCalledWith({ where: { id: 'node-anytls' } });
      expect(mockDeploy.deploy).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns all nodes when no serverId filter', async () => {
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([fakeNode]);
      const result = await svc.findAll('user-id-1');
      expect(result).toHaveLength(1);
      expect((mockPrisma.node.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 'user-id-1' });
    });

    it('filters by serverId when provided', async () => {
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([fakeNode]);
      await svc.findAll('user-id-1', 'srv-1');
      expect((mockPrisma.node.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 'user-id-1', serverId: 'srv-1' });
    });
  });

  describe('findOne', () => {
    it('returns the node when found', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(fakeNode);
      await expect(svc.findOne('node-1', 'user-id-1')).resolves.toBe(fakeNode);
    });

    it('throws NotFoundException when node is missing', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(svc.findOne('missing', 'user-id-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('re-encrypts credentials when provided in update', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue(fakeNode);
      await svc.update('node-1', { credentials: { uuid: 'new-uuid' } } as any, 'user-id-1');
      expect(mockCrypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ uuid: 'new-uuid' }));
    });

    it('does not re-encrypt when credentials not provided', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue(fakeNode);
      await svc.update('node-1', { name: 'Renamed' } as any, 'user-id-1');
      expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for missing node', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(svc.update('bad', {} as any, 'user-id-1')).rejects.toThrow(NotFoundException);
    });

    it('defaults credentials and shape when updating a node to XHTTP', async () => {
      const existing = { ...fakeNode, credentialsEnc: 'enc:{"uuid":"existing-uuid"}' };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...existing, transport: 'XHTTP' });

      await svc.update('node-1', {
        protocol: 'VLESS', transport: 'XHTTP', listenPort: 443,
      } as any, 'user-id-1');

      const data = (mockPrisma.node.update as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({
        protocol: 'VLESS', implementation: 'XRAY', transport: 'XHTTP', tls: 'REALITY',
        listenPort: 443,
      });
      const credentials = JSON.parse(
        (mockCrypto.encrypt as jest.Mock).mock.calls[0][0],
      ) as Record<string, string>;
      expect(credentials.uuid).toBe('existing-uuid');
      expect(credentials.shortId).toMatch(/^[0-9a-f]{16}$/);
      expect(credentials.path).toMatch(/^\//);
    });

    it('adds managed DNS atomically when updating a node to AnyTLS', async () => {
      const existing = {
        ...fakeNode,
        cfDnsRecordId: null,
        credentialsEnc: 'enc:{}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...existing, protocol: 'ANYTLS' });

      await svc.update('node-1', {
        protocol: 'ANYTLS',
      } as any, 'user-id-1');

      const data = (mockPrisma.node.update as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({
        protocol: 'ANYTLS',
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        source: 'AUTO',
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'cf-record-id',
      });
      expect(mockPrisma.server.findUnique).toHaveBeenCalledWith({
        where: { id: 'srv-1' }, select: { ip: true },
      });
      const credentials = JSON.parse(
        (mockCrypto.encrypt as jest.Mock).mock.calls[0][0],
      ) as Record<string, string>;
      expect(credentials.password).toHaveLength(32);
    });

    it('replaces an existing proxied record when entering TUIC', async () => {
      const existing = {
        ...fakeNode,
        protocol: 'VLESS',
        implementation: 'XRAY',
        transport: 'WS',
        tls: 'TLS',
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'proxied-record-id',
        credentialsEnc: 'enc:{"uuid":"existing-uuid"}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...existing, protocol: 'TUIC' });

      await svc.update('node-1', { protocol: 'TUIC' } as any, 'user-id-1');

      const transitionDomain = (mockCfService.createARecord as jest.Mock).mock.calls[0][2];
      expect(transitionDomain).toMatch(/^np-node-1-[0-9a-f]{6}\.example\.com$/);
      expect(mockCfService.createARecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', transitionDomain, '1.2.3.4', false,
      );
      const data = (mockPrisma.node.update as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({
        protocol: 'TUIC',
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        domain: transitionDomain,
        cfDnsRecordId: 'cf-record-id',
      });
      expect(mockCfService.deleteRecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'proxied-record-id',
      );
    });

    it('keeps the old record and removes the new record when a managed transition fails', async () => {
      const existing = {
        ...fakeNode,
        protocol: 'VLESS',
        implementation: 'XRAY',
        transport: 'WS',
        tls: 'TLS',
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'proxied-record-id',
        credentialsEnc: 'enc:{"uuid":"existing-uuid"}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });
      (mockPrisma.node.update as jest.Mock).mockRejectedValue(new Error('database failed'));

      await expect(
        svc.update('node-1', { protocol: 'ANYTLS' } as any, 'user-id-1'),
      ).rejects.toThrow('database failed');

      expect(mockCfService.deleteRecord).toHaveBeenCalledTimes(1);
      expect(mockCfService.deleteRecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'cf-record-id',
      );
      expect(mockCfService.deleteRecord).not.toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'proxied-record-id',
      );
    });

    it('retires a legacy TLS DNS record only after switching to XHTTP succeeds', async () => {
      const existing = {
        ...fakeNode,
        protocol: 'VLESS',
        implementation: 'XRAY',
        transport: 'WS',
        tls: 'TLS',
        listenPort: 8443,
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'old-record-id',
        credentialsEnc: 'enc:{"uuid":"existing-uuid"}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({
        ...existing, transport: 'XHTTP', tls: 'REALITY', listenPort: 443,
      });
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });

      await svc.update('node-1', {
        protocol: 'VLESS', transport: 'XHTTP', listenPort: 443,
      } as any, 'user-id-1');

      expect((mockPrisma.node.update as jest.Mock).mock.calls[0][0].data).toMatchObject({
        transport: 'XHTTP', tls: 'REALITY', domain: null, cfDnsRecordId: null,
      });
      expect(mockDeploy.deploy).toHaveBeenCalled();
      expect(mockCfService.deleteRecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'old-record-id',
      );
    });

    it('restores a legacy TLS hostname and DNS id when XHTTP deployment fails', async () => {
      const existing = {
        ...fakeNode,
        protocol: 'VLESS',
        implementation: 'XRAY',
        transport: 'WS',
        tls: 'TLS',
        listenPort: 8443,
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'old-record-id',
        credentialsEnc: 'enc:{"uuid":"existing-uuid"}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.node.update as jest.Mock)
        .mockResolvedValueOnce({ ...existing, transport: 'XHTTP', tls: 'REALITY' })
        .mockResolvedValueOnce(existing);
      (mockDeploy.deploy as jest.Mock).mockResolvedValue({
        success: false, log: 'xray failed to start',
      });

      await expect(svc.update('node-1', {
        protocol: 'VLESS', transport: 'XHTTP', listenPort: 443,
      } as any, 'user-id-1')).rejects.toThrow('节点部署失败，已恢复原配置');

      expect((mockPrisma.node.update as jest.Mock).mock.calls[1][0].data).toMatchObject({
        transport: 'WS', tls: 'TLS', listenPort: 8443,
        domain: 'np-node-1.example.com', cfDnsRecordId: 'old-record-id',
      });
      expect(mockCfService.deleteRecord).not.toHaveBeenCalled();
    });

    it('restores the database and keeps the old DNS record when AnyTLS deployment fails', async () => {
      const existing = {
        ...fakeNode,
        cfDnsRecordId: 'proxied-record-id',
        domain: 'np-node-1.example.com',
        credentialsEnc: 'enc:{"uuid":"existing-uuid"}',
        source: 'MANUAL',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });
      (mockPrisma.node.update as jest.Mock)
        .mockResolvedValueOnce({ ...existing, protocol: 'ANYTLS' })
        .mockResolvedValueOnce(existing);
      (mockDeploy.deploy as jest.Mock).mockResolvedValue({
        success: false,
        log: 'sing-box failed to start',
      });

      await expect(
        svc.update('node-1', { protocol: 'ANYTLS' } as any, 'user-id-1'),
      ).rejects.toThrow('节点部署失败，已恢复原配置');

      expect(mockDeploy.deploy).toHaveBeenCalledWith(
        'node-1', undefined, undefined, undefined,
        {
          forceRollback: false,
          skipAdvisoryLock: true,
          previousFirewall: { port: 10086, protocol: 'VMESS' },
        },
      );
      expect(mockPrisma.node.update).toHaveBeenCalledTimes(2);
      expect((mockPrisma.node.update as jest.Mock).mock.calls[1][0]).toMatchObject({
        where: { id: 'node-1' },
        data: {
          protocol: 'VMESS',
          implementation: 'XRAY',
          transport: 'TCP',
          tls: 'NONE',
          domain: 'np-node-1.example.com',
          cfDnsRecordId: 'proxied-record-id',
          credentialsEnc: 'enc:{"uuid":"existing-uuid"}',
          source: 'MANUAL',
        },
      });
      expect(mockCfService.deleteRecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'cf-record-id',
      );
      expect(mockCfService.deleteRecord).not.toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'proxied-record-id',
      );
    });

    it('does not claim database compensation when remote rollback failed', async () => {
      const existing = {
        ...fakeNode,
        cfDnsRecordId: 'proxied-record-id',
        domain: 'np-node-1.example.com',
        credentialsEnc: 'enc:{"uuid":"existing-uuid"}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...existing, protocol: 'ANYTLS' });
      (mockDeploy.deploy as jest.Mock).mockResolvedValue({
        success: false,
        rollbackFailed: true,
        log: 'backups retained at /etc/nextpanel/node.rollback',
      });

      await expect(
        svc.update('node-1', { protocol: 'ANYTLS' } as any, 'user-id-1'),
      ).rejects.toThrow('远程旧配置未能恢复');

      expect(mockPrisma.node.update).toHaveBeenCalledTimes(1);
      expect(mockCfService.deleteRecord).not.toHaveBeenCalled();
    });

    it('removes a pending DNS record when an AnyTLS update fails', async () => {
      const existing = {
        ...fakeNode,
        cfDnsRecordId: null,
        credentialsEnc: 'enc:{}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });
      (mockPrisma.node.update as jest.Mock).mockRejectedValue(new Error('database failed'));

      await expect(
        svc.update('node-1', { protocol: 'ANYTLS' } as any, 'user-id-1'),
      ).rejects.toThrow('database failed');

      expect(mockCfService.deleteRecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'cf-record-id',
      );
      expect(mockPrisma.node.delete).not.toHaveBeenCalled();
    });

    it('clears managed DNS when updating away from TUIC', async () => {
      const existing = {
        ...fakeNode,
        protocol: 'TUIC',
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'old-record-id',
        credentialsEnc: 'enc:{"uuid":"old","password":"old"}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...fakeNode, protocol: 'VMESS' });
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });

      await svc.update('node-1', {
        protocol: 'VMESS', implementation: 'XRAY', transport: 'TCP', tls: 'NONE',
        credentials: { uuid: 'new-uuid' },
      } as any, 'user-id-1');

      const data = (mockPrisma.node.update as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({ domain: null, cfDnsRecordId: null });
      expect(mockCfService.deleteRecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'old-record-id',
      );
    });

    it('restores TUIC and keeps its DNS record when a legacy replacement fails', async () => {
      const existing = {
        ...fakeNode,
        protocol: 'TUIC',
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'old-record-id',
        credentialsEnc: 'enc:{"uuid":"old","password":"old"}',
        source: 'AUTO',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      (mockPrisma.node.update as jest.Mock)
        .mockResolvedValueOnce({ ...fakeNode, protocol: 'VMESS' })
        .mockResolvedValueOnce(existing);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockDeploy.deploy as jest.Mock).mockResolvedValue({
        success: false,
        log: 'xray failed to start',
      });

      await expect(svc.update('node-1', {
        protocol: 'VMESS', implementation: 'XRAY', transport: 'TCP', tls: 'NONE',
        credentials: { uuid: 'new-uuid' },
      } as any, 'user-id-1')).rejects.toThrow('节点部署失败，已恢复原配置');

      expect(mockDeploy.deploy).toHaveBeenCalledWith(
        'node-1', undefined, undefined, undefined,
        {
          forceRollback: true,
          skipAdvisoryLock: true,
          previousFirewall: { port: 10086, protocol: 'TUIC' },
        },
      );
      expect(mockPrisma.node.update).toHaveBeenCalledTimes(2);
      expect((mockPrisma.node.update as jest.Mock).mock.calls[1][0].data).toMatchObject({
        protocol: 'TUIC',
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'old-record-id',
        credentialsEnc: 'enc:{"uuid":"old","password":"old"}',
      });
      expect(mockCfService.deleteRecord).not.toHaveBeenCalledWith(
        'cf-token', 'zone-1', 'old-record-id',
      );
    });

    it('rejects moving an existing managed TLS node to another server', async () => {
      const existing = {
        ...fakeNode,
        serverId: 'srv-1',
        protocol: 'TUIC',
        implementation: 'SING_BOX',
        transport: null,
        tls: 'TLS',
        domain: 'np-node-1.example.com',
        cfDnsRecordId: 'record-id',
        credentialsEnc: 'enc:{"uuid":"old","password":"old"}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);

      await expect(
        svc.update('node-1', { serverId: 'srv-2' } as any, 'user-id-1'),
      ).rejects.toThrow(
        '节点不支持在更新时更换服务器，请在目标服务器上创建新节点',
      );

      expect(mockCfSettings.verify).not.toHaveBeenCalled();
      expect(mockCfService.createARecord).not.toHaveBeenCalled();
      expect(mockPrisma.node.update).not.toHaveBeenCalled();
    });

    it('rejects moving to another server while entering a modern protocol', async () => {
      const existing = {
        ...fakeNode,
        serverId: 'srv-1',
        credentialsEnc: 'enc:{"uuid":"old"}',
      };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);

      await expect(svc.update('node-1', {
        serverId: 'srv-2',
        protocol: 'VLESS',
        transport: 'XHTTP',
      } as any, 'user-id-1')).rejects.toThrow(
        '节点不支持在更新时更换服务器',
      );

      expect(mockPrisma.node.update).not.toHaveBeenCalled();
      expect(mockDeploy.deploy).not.toHaveBeenCalled();
    });

    it('rejects changing serverId for legacy nodes as well', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({
        ...fakeNode,
        serverId: 'srv-1',
        credentialsEnc: 'enc:{"uuid":"old"}',
      });

      await expect(
        svc.update('node-1', { serverId: 'srv-2' } as any, 'user-id-1'),
      ).rejects.toThrow('节点不支持在更新时更换服务器');

      expect(mockPrisma.node.update).not.toHaveBeenCalled();
      expect(mockDeploy.deploy).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('calls undeploy and then deletes', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.node.delete as jest.Mock).mockResolvedValue(fakeNode);
      await svc.remove('node-1', 'user-id-1');
      expect(mockDeploy.undeploy).toHaveBeenCalledWith('node-1', { skipAdvisoryLock: true });
      expect(mockPrisma.node.delete).toHaveBeenCalledWith({ where: { id: 'node-1' } });
    });
  });

  describe('update – redeploy error logging', () => {
    it('logs error when redeploy rejects', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue(fakeNode);
      (mockDeploy.deploy as jest.Mock).mockRejectedValue(new Error('ssh fail'));

      await svc.update('node-1', { name: 'Renamed' } as any, 'user-id-1');
      // flush microtasks so the catch callback runs
      await new Promise((r) => setTimeout(r, 0));

      // no throw — error is caught and logged
    });
  });

  describe('remove – undeploy error propagation', () => {
    it('throws and aborts deletion when undeploy rejects (SSH-first pattern)', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.node.delete as jest.Mock).mockResolvedValue(fakeNode);
      (mockDeploy.undeploy as jest.Mock).mockRejectedValue(new Error('undeploy fail'));

      await expect(svc.remove('node-1', 'user-id-1')).rejects.toThrow('undeploy fail');
      expect(mockPrisma.node.delete).not.toHaveBeenCalled();
    });
  });

  describe('create – protocol+TLS validation', () => {
    it.each([
      ['VMESS', 'REALITY'],
      ['TROJAN', 'REALITY'],
      ['SHADOWSOCKS', 'REALITY'],
    ])('%s+REALITY 创建时应抛出 BadRequestException', async (protocol, tls) => {
      const dto = { serverId: 's', name: 'N', protocol, tls, listenPort: 443, credentials: {} } as any;
      await expect(svc.create(dto, 'user-id-1')).rejects.toThrow('REALITY 仅支持 VLESS 协议');
    });

    it('update 时切换为非法组合（TROJAN+REALITY）应抛出 BadRequestException', async () => {
      const existing = { ...fakeNode, protocol: 'TROJAN', tls: 'NONE', credentialsEnc: 'enc:{}' };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      await expect(svc.update('node-1', { tls: 'REALITY' as any } as any, 'user-id-1'))
        .rejects.toThrow('REALITY 仅支持 VLESS 协议');
    });

    it('update 时把协议改为非 VLESS 且已有 REALITY TLS 应抛出 BadRequestException', async () => {
      const existing = { ...fakeNode, protocol: 'VLESS', tls: 'REALITY', credentialsEnc: 'enc:{"realityPrivateKey":"pk","realityPublicKey":"pub"}' };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(existing);
      await expect(svc.update('node-1', { protocol: 'TROJAN' as any } as any, 'user-id-1'))
        .rejects.toThrow('REALITY 仅支持 VLESS 协议');
    });
  });

  describe('create – REALITY key generation', () => {
    it('auto-generates REALITY keys when tls is REALITY and credentials have no keys', async () => {
      (mockPrisma.node.create as jest.Mock).mockResolvedValue(fakeNode);
      (mockDeploy.deploy as jest.Mock).mockResolvedValue({ success: true, log: '' });
      const dto = {
        serverId: 's', name: 'N', protocol: 'VLESS', tls: 'REALITY',
        listenPort: 443, credentials: {}, enabled: true,
      } as any;
      await svc.create(dto, 'user-id-1');
      const encArg = (mockCrypto.encrypt as jest.Mock).mock.calls[0][0];
      const parsed = JSON.parse(encArg) as Record<string, string>;
      expect(parsed.realityPrivateKey).toBeDefined();
      expect(parsed.realityPublicKey).toBeDefined();
    });

    it('does not overwrite existing REALITY keys on create', async () => {
      (mockPrisma.node.create as jest.Mock).mockResolvedValue(fakeNode);
      (mockDeploy.deploy as jest.Mock).mockResolvedValue({ success: true, log: '' });
      const dto = {
        serverId: 's', name: 'N', protocol: 'VLESS', tls: 'REALITY',
        listenPort: 443, credentials: { realityPrivateKey: 'mykey', realityPublicKey: 'mypub' }, enabled: true,
      } as any;
      await svc.create(dto, 'user-id-1');
      const encArg = (mockCrypto.encrypt as jest.Mock).mock.calls[0][0];
      const parsed = JSON.parse(encArg) as Record<string, string>;
      expect(parsed.realityPrivateKey).toBe('mykey');
    });
  });

  describe('create – deploy error logging', () => {
    it('logs error without throwing when initial deploy rejects', async () => {
      (mockPrisma.node.create as jest.Mock).mockResolvedValue(fakeNode);
      (mockDeploy.deploy as jest.Mock).mockRejectedValue(new Error('ssh connect failed'));
      const dto = { serverId: 's', name: 'N', protocol: 'VMESS', listenPort: 80, credentials: {} } as any;
      await svc.create(dto, 'user-id-1');
      await new Promise((r) => setTimeout(r, 0));
      // Error is caught and logged; no throw propagated to caller
    });
  });

  describe('update – REALITY credentials', () => {
    it('generates REALITY keys when update switches tls to REALITY without existing keys', async () => {
      const nodeWithCreds = { ...fakeNode, protocol: 'VLESS', tls: 'NONE', credentialsEnc: 'enc:{"uuid":"u1"}' };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(nodeWithCreds);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue(fakeNode);

      await svc.update('node-1', { tls: 'REALITY' as any } as any, 'user-id-1');

      const encArg = (mockCrypto.encrypt as jest.Mock).mock.calls[0][0];
      const parsed = JSON.parse(encArg) as Record<string, string>;
      expect(parsed.realityPrivateKey).toBeDefined();
      expect(parsed.realityPublicKey).toBeDefined();
      expect(parsed.uuid).toBe('u1'); // existing credential preserved
    });

    it('merges incoming credentials with existing when updating REALITY node', async () => {
      const nodeWithCreds = { ...fakeNode, protocol: 'VLESS', tls: 'REALITY', credentialsEnc: 'enc:{"realityPrivateKey":"pk","realityPublicKey":"pub"}' };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(nodeWithCreds);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue(fakeNode);

      await svc.update('node-1', { tls: 'REALITY' as any, credentials: { uuid: 'new-uuid' } } as any, 'user-id-1');

      const encArg = (mockCrypto.encrypt as jest.Mock).mock.calls[0][0];
      const parsed = JSON.parse(encArg) as Record<string, string>;
      expect(parsed.uuid).toBe('new-uuid');
      expect(parsed.realityPrivateKey).toBe('pk');
    });
  });

  describe('createFromPreset', () => {
    it('rejects a preset deployment to another user\'s server', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.createFromPreset('user-1', {
        serverId: 'other-server', name: 'Unauthorized', preset: 'VLESS_REALITY',
      })).rejects.toThrow('Server other-server not found');

      expect(mockPrisma.node.create).not.toHaveBeenCalled();
    });

    it('creates node with auto-generated credentials for VLESS_REALITY', async () => {
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]); // no existing ports
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-preset' });
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-preset' });

      const result = await svc.createFromPreset('user-1', {
        serverId: 'srv-1',
        name: 'My REALITY Node',
        preset: 'VLESS_REALITY',
      });

      expect(mockPrisma.node.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            protocol: 'VLESS',
            tls: 'REALITY',
            source: 'AUTO',
            userId: 'user-1',
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it('uses fixed port 443 for VLESS_WS_TLS', async () => {
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-ws' });
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-ws' });

      await svc.createFromPreset('user-1', {
        serverId: 'srv-1',
        name: 'WS Node',
        preset: 'VLESS_WS_TLS',
      });

      const createData = (mockPrisma.node.create as jest.Mock).mock.calls[0][0].data;
      expect(createData.listenPort).toBe(443);
    });

    it('creates VLESS_XHTTP_REALITY on recommended port 443 with complete credentials', async () => {
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-xhttp' });
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-xhttp' });

      await svc.createFromPreset('user-1', {
        serverId: 'srv-1', name: 'XHTTP Node', preset: 'VLESS_XHTTP_REALITY',
      });

      const createData = (mockPrisma.node.create as jest.Mock).mock.calls[0][0].data;
      expect(createData).toMatchObject({
        protocol: 'VLESS',
        implementation: 'XRAY',
        transport: 'XHTTP',
        tls: 'REALITY',
        listenPort: 443,
      });
      const credentials = JSON.parse(
        (mockCrypto.encrypt as jest.Mock).mock.calls[0][0],
      ) as Record<string, string>;
      expect(credentials.uuid).toBeTruthy();
      expect(credentials.realityPrivateKey).toBeTruthy();
      expect(credentials.realityPublicKey).toBeTruthy();
      expect(credentials.shortId).toMatch(/^[0-9a-f]{16}$/);
      expect(credentials.path).toMatch(/^\//);
      expect(mockCfSettings.verify).not.toHaveBeenCalled();
    });

    it.each([
      [{ listenPort: 443, statsPort: null }, 443],
      [{ listenPort: 10000, statsPort: 20443 }, 20443],
    ])('rejects fixed port 443 when server port %s conflicts', async (existingNode, conflict) => {
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([{
        ...existingNode,
        serverId: 'srv-1',
        implementation: 'XRAY',
        exitServerId: null,
        exitPort: null,
      }]);

      await expect(svc.createFromPreset('user-1', {
        serverId: 'srv-1', name: 'XHTTP Node', preset: 'VLESS_XHTTP_REALITY',
      })).rejects.toThrow(
        `固定端口 443 无法使用：服务器端口 ${conflict} 已被其他节点占用`,
      );

      expect(mockPrisma.node.create).not.toHaveBeenCalled();
    });

    it.each([
      ['TUIC_V5', 'TUIC', 16000, true],
      ['ANYTLS', 'ANYTLS', 17000, false],
    ])('creates %s with DNS-only Cloudflare and protocol credentials', async (
      preset, protocol, listenPort, hasUuid,
    ) => {
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: `node-${protocol}` });
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ ...fakeNode, id: `node-${protocol}` });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '1.2.3.4' });

      await svc.createFromPreset('user-1', {
        serverId: 'srv-1', name: `${protocol} Node`, preset: preset as any,
      });

      const createData = (mockPrisma.node.create as jest.Mock).mock.calls[0][0].data;
      expect(createData).toMatchObject({
        protocol, implementation: 'SING_BOX', transport: null, tls: 'TLS', listenPort,
      });
      const credentials = JSON.parse(
        (mockCrypto.encrypt as jest.Mock).mock.calls[0][0],
      ) as Record<string, string>;
      expect(credentials.password).toHaveLength(32);
      if (hasUuid) expect(credentials.uuid).toMatch(/^[0-9a-f-]{36}$/i);
      else expect(credentials.uuid).toBeUndefined();
      expect(mockCfService.createARecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', expect.stringContaining('example.com'), '1.2.3.4', false,
      );
    });
  });

  describe('getShareLink', () => {
    it('returns a share URI for a VMESS node', async () => {
      const fakeNodeWithServer = { ...fakeNode, protocol: 'VMESS', transport: 'TCP', tls: 'NONE', domain: null, server: { ip: '1.2.3.4' } };
      (mockPrisma.node.findFirst as jest.Mock)
        .mockResolvedValueOnce(fakeNodeWithServer)
        .mockResolvedValueOnce({ credentialsEnc: 'enc:{"uuid":"test-uuid"}' });

      const uri = await svc.getShareLink('node-1', 'user-id-1');
      expect(uri).not.toBeNull();
      expect(uri).toContain('vmess://');
    });

    it('returns null for an unsupported protocol', async () => {
      const fakeNodeWithServer = { ...fakeNode, protocol: 'UNKNOWN', domain: null, server: { ip: '1.2.3.4' } };
      (mockPrisma.node.findFirst as jest.Mock)
        .mockResolvedValueOnce(fakeNodeWithServer)
        .mockResolvedValueOnce({ credentialsEnc: 'enc:{}' });

      const uri = await svc.getShareLink('node-1', 'user-id-1');
      expect(uri).toBeNull();
    });

    it('throws NotFoundException when node is missing', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(svc.getShareLink('bad', 'user-id-1')).rejects.toThrow(NotFoundException);
    });

    it('uses domain as host when domain is set (CDN node connects via domain)', async () => {
      const fakeNodeWithDomain = { ...fakeNode, protocol: 'VLESS', transport: 'TCP', tls: 'NONE', domain: 'cdn.example.com', server: { ip: '1.2.3.4' } };
      (mockPrisma.node.findFirst as jest.Mock)
        .mockResolvedValueOnce(fakeNodeWithDomain)
        .mockResolvedValueOnce({ credentialsEnc: 'enc:{"uuid":"u1"}' });

      const uri = await svc.getShareLink('node-1', 'user-id-1');
      expect(uri).toContain('cdn.example.com');
      expect(uri).not.toContain('1.2.3.4');
    });

    it('uses server IP as connection host for REALITY and keeps domain as SNI', async () => {
      const realityNode = {
        ...fakeNode,
        protocol: 'VLESS',
        transport: 'XHTTP',
        tls: 'REALITY',
        domain: 'disguise.example.com',
        server: { ip: '1.2.3.4' },
      };
      (mockPrisma.node.findFirst as jest.Mock)
        .mockResolvedValueOnce(realityNode)
        .mockResolvedValueOnce({
          credentialsEnc: 'enc:{"uuid":"u1","realityPublicKey":"pub","shortId":"0123456789abcdef"}',
        });

      const uri = await svc.getShareLink('node-1', 'user-id-1');
      expect(uri).toContain('@1.2.3.4:');
      expect(uri).toContain('sni=disguise.example.com');
      expect(uri).not.toContain('@disguise.example.com:');
    });
  });

  describe('getCredentials', () => {
    it('decrypts and parses credentials', async () => {
      const encrypted = 'enc:{"uuid":"abc-123"}';
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ credentialsEnc: encrypted });
      (mockCrypto.decrypt as jest.Mock).mockReturnValue('{"uuid":"abc-123"}');
      const creds = await svc.getCredentials('node-1', 'user-id-1');
      expect(creds).toEqual({ uuid: 'abc-123' });
    });

    it('throws NotFoundException when node is missing', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(svc.getCredentials('bad', 'user-id-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('rename', () => {
    it('updates the node name and returns updated node', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...fakeNode, name: 'New Name' });

      const result = await svc.rename('node-1', 'New Name', 'user-id-1');

      expect(mockPrisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'node-1' }, data: { name: 'New Name' } }),
      );
      expect(result).toMatchObject({ name: 'New Name' });
    });

    it('throws NotFoundException when node is missing', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(svc.rename('bad', 'X', 'user-id-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggle', () => {
    it('disables an enabled node and sets status to STOPPED', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ id: 'node-1', enabled: true });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...fakeNode, enabled: false, status: 'STOPPED' });

      const result = await svc.toggle('node-1', 'user-id-1');

      expect(mockDeploy.toggleService).toHaveBeenCalledWith(
        'node-1',
        false,
        { skipAdvisoryLock: true },
      );
      expect(mockPrisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ enabled: false, status: 'STOPPED' }) }),
      );
      expect(result).toMatchObject({ enabled: false });
    });

    it('enables a disabled node and sets status to RUNNING', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ id: 'node-1', enabled: false });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...fakeNode, enabled: true, status: 'RUNNING' });

      await svc.toggle('node-1', 'user-id-1');

      expect(mockDeploy.toggleService).toHaveBeenCalledWith(
        'node-1',
        true,
        { skipAdvisoryLock: true },
      );
      expect(mockPrisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ enabled: true, status: 'RUNNING' }) }),
      );
    });

    it('throws NotFoundException when node is missing', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(svc.toggle('bad', 'user-id-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove — with Cloudflare DNS cleanup', () => {
    beforeEach(() => {
      (mockDeploy.undeploy as jest.Mock).mockResolvedValue(undefined);
    });

    it('cleans up Cloudflare DNS record when cfDnsRecordId is set', async () => {
      const nodeWithCf = { id: 'node-1', userId: 'user-1', cfDnsRecordId: 'rec-abc' };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(nodeWithCf);
      (mockPrisma.node.delete as jest.Mock).mockResolvedValue(nodeWithCf);
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'token', domain: 'example.com', zoneId: 'zone-1',
      });

      await svc.remove('node-1', 'user-id-1');

      expect(mockCfService.deleteRecord).toHaveBeenCalledWith('token', 'zone-1', 'rec-abc');
    });

    it('skips Cloudflare cleanup when cfDnsRecordId is null', async () => {
      const nodeNoCf = { id: 'node-1', userId: 'user-1', cfDnsRecordId: null };
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(nodeNoCf);
      (mockPrisma.node.delete as jest.Mock).mockResolvedValue(nodeNoCf);

      await svc.remove('node-1', 'user-id-1');

      expect(mockCfService.deleteRecord).not.toHaveBeenCalled();
    });
  });

  describe('getLatestSnapshot', () => {
    it('returns the latest snapshot for a node', async () => {
      const mockPrismaWithSnapshot = mockPrisma as any;
      if (!mockPrismaWithSnapshot.configSnapshot) {
        mockPrismaWithSnapshot.configSnapshot = { findFirst: jest.fn() };
      }
      const snapshot = { version: 3, deployLog: 'ok', createdAt: new Date() };
      (mockPrismaWithSnapshot.configSnapshot.findFirst as jest.Mock).mockResolvedValue(snapshot);

      const result = await svc.getLatestSnapshot('node-1');
      expect(result).toBe(snapshot);
    });
  });

  describe('createFromPreset — Cloudflare DNS provisioning', () => {
    it('provisions Cloudflare DNS when preset is VLESS_WS_TLS and CF settings exist', async () => {
      (mockCfSettings.verify as jest.Mock).mockResolvedValue({ valid: true, zoneStatus: 'active' });
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-ws' });
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'node-ws' });
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      const mockServer = { ip: '1.2.3.4' };
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(mockServer);
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});

      await svc.createFromPreset('user-1', { serverId: 'srv-1', name: 'WS Node', preset: 'VLESS_WS_TLS' });

      expect(mockCfSettings.getDecryptedToken).toHaveBeenCalledWith('user-1');
      expect(mockCfService.createARecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', expect.stringContaining('example.com'), '1.2.3.4', true,
      );
    });

    it('throws BadRequestException when CF not configured', async () => {
      (mockCfSettings.verify as jest.Mock).mockResolvedValue({ valid: false, message: '未配置 Cloudflare 设置' });

      await expect(
        svc.createFromPreset('user-1', { serverId: 'srv-1', name: 'WS Node', preset: 'VLESS_WS_TLS' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when CF zone is not active', async () => {
      (mockCfSettings.verify as jest.Mock).mockResolvedValue({ valid: true, zoneStatus: 'pending' });

      await expect(
        svc.createFromPreset('user-1', { serverId: 'srv-1', name: 'WS Node', preset: 'VLESS_WS_TLS' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createChainNode — modern protocol DNS', () => {
    it('provisions a DNS-only record to the entry server for TUIC', async () => {
      (mockPrisma.server.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'entry-1', ip: '10.0.0.1', sshAuthEnc: 'entry-auth' })
        .mockResolvedValueOnce({ id: 'exit-1', ip: '10.0.0.2', sshAuthEnc: 'exit-auth' });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '10.0.0.1' });
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'chain-tuic' });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'chain-tuic' });
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });

      await svc.createChainNode('user-1', {
        name: 'Chain TUIC',
        preset: 'TUIC_V5',
        entryServerId: 'entry-1',
        exitServerId: 'exit-1',
      });

      const createData = (mockPrisma.node.create as jest.Mock).mock.calls[0][0].data;
      expect(createData).toMatchObject({
        serverId: 'entry-1',
        exitServerId: 'exit-1',
        protocol: 'TUIC',
        listenPort: 16000,
        exitPort: 15000,
      });
      const chainCredentials = JSON.parse(
        (mockCrypto.encrypt as jest.Mock).mock.calls[1][0],
      ) as Record<string, string>;
      expect(chainCredentials.uuid).toMatch(/^[0-9a-f-]{36}$/i);
      expect(chainCredentials.realityPrivateKey).toBeTruthy();
      expect(chainCredentials.realityPublicKey).toBeTruthy();
      expect(chainCredentials.shortId).toMatch(/^[0-9a-f]{16}$/);
      expect(createData.chainCredEnc).toBe(`enc:${JSON.stringify(chainCredentials)}`);
      expect(mockCfService.createARecord).toHaveBeenCalledWith(
        'cf-token', 'zone-1', expect.stringContaining('example.com'), '10.0.0.1', false,
      );
    });

    it('rolls back a chain node when AnyTLS DNS provisioning fails', async () => {
      (mockPrisma.server.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'entry-1', ip: '10.0.0.1', sshAuthEnc: 'entry-auth' })
        .mockResolvedValueOnce({ id: 'exit-1', ip: '10.0.0.2', sshAuthEnc: 'exit-auth' });
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue({ ip: '10.0.0.1' });
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.node.create as jest.Mock).mockResolvedValue({ ...fakeNode, id: 'chain-anytls' });
      (mockPrisma.node.delete as jest.Mock).mockResolvedValue({});
      (mockCfSettings.getDecryptedToken as jest.Mock).mockResolvedValue({
        apiToken: 'cf-token', domain: 'example.com', zoneId: 'zone-1',
      });
      (mockCfService.createARecord as jest.Mock).mockRejectedValue(new Error('dns failed'));

      await expect(svc.createChainNode('user-1', {
        name: 'Chain AnyTLS',
        preset: 'ANYTLS',
        entryServerId: 'entry-1',
        exitServerId: 'exit-1',
      })).rejects.toThrow('dns failed');

      expect(mockPrisma.node.delete).toHaveBeenCalledWith({ where: { id: 'chain-anytls' } });
      expect(mockPrisma.node.findFirst).not.toHaveBeenCalled();
    });
  });
});
