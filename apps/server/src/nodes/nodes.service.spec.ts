import { NodesService } from './nodes.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from './node-deploy.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CreateNodeDto } from './dto/create-node.dto';

const mockPrisma = {
  node: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
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

beforeEach(() => jest.clearAllMocks());

describe('NodesService', () => {
  describe('create', () => {
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
  });

  describe('remove', () => {
    it('calls undeploy and then deletes', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.node.delete as jest.Mock).mockResolvedValue(fakeNode);
      await svc.remove('node-1', 'user-id-1');
      expect(mockDeploy.undeploy).toHaveBeenCalledWith('node-1');
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

      expect(mockDeploy.toggleService).toHaveBeenCalledWith('node-1', false);
      expect(mockPrisma.node.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ enabled: false, status: 'STOPPED' }) }),
      );
      expect(result).toMatchObject({ enabled: false });
    });

    it('enables a disabled node and sets status to RUNNING', async () => {
      (mockPrisma.node.findFirst as jest.Mock).mockResolvedValue({ id: 'node-1', enabled: false });
      (mockPrisma.node.update as jest.Mock).mockResolvedValue({ ...fakeNode, enabled: true, status: 'RUNNING' });

      await svc.toggle('node-1', 'user-id-1');

      expect(mockDeploy.toggleService).toHaveBeenCalledWith('node-1', true);
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
      (mockPrisma as any).server = { findUnique: jest.fn().mockResolvedValue(mockServer) };
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
});
