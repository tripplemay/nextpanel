import { ExternalNodesService } from './external-nodes.service';
import { PrismaService } from '../prisma.service';
import { XrayTestService } from '../nodes/xray-test/xray-test.service';
import { SingboxTestService } from '../nodes/singbox-test/singbox-test.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

const mockPrisma = {
  externalNode: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
} as unknown as PrismaService;

const mockXrayTest = {
  testWithParams: jest.fn(),
} as unknown as XrayTestService;

const mockSingboxTest = {
  testHysteria2: jest.fn(),
} as unknown as SingboxTestService;

const svc = new ExternalNodesService(mockPrisma, mockXrayTest, mockSingboxTest);

const fakeNode = {
  id: 'en-1',
  userId: 'user-1',
  protocol: 'VLESS',
  address: '1.2.3.4',
  port: 443,
  uuid: 'some-uuid',
  password: null,
  method: null,
  transport: 'ws',
  tls: 'TLS',
  sni: 'cdn.example.com',
  path: '/ws',
};

beforeEach(() => jest.clearAllMocks());

describe('ExternalNodesService', () => {
  describe('list', () => {
    it('returns nodes for userId', async () => {
      (mockPrisma.externalNode.findMany as jest.Mock).mockResolvedValue([fakeNode]);
      const result = await svc.list('user-1');
      expect(result).toEqual([fakeNode]);
      expect((mockPrisma.externalNode.findMany as jest.Mock).mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    });
  });

  describe('import', () => {
    it('returns 0 success when no nodes parsed', async () => {
      const result = await svc.import('user-1', 'invalid-text-not-a-uri');
      expect(result.success).toBe(0);
      expect(result.errors).toContain('未能解析出任何有效节点');
    });

    it('creates nodes from valid URIs', async () => {
      (mockPrisma.externalNode.createMany as jest.Mock).mockResolvedValue({ count: 1 });
      const vlessUri = 'vless://some-uuid@1.2.3.4:443?type=ws&security=tls&sni=test.com#Test+Node';
      const result = await svc.import('user-1', vlessUri);
      expect(result.success).toBe(1);
      expect(mockPrisma.externalNode.createMany).toHaveBeenCalled();
    });

    it('fetches URL when text starts with https://', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);
      await expect(svc.import('user-1', 'https://example.com/sub')).rejects.toThrow(BadRequestException);
      fetchSpy.mockRestore();
    });

    it('resolves URL content and imports nodes', async () => {
      const vlessUri = 'vless://some-uuid@1.2.3.4:443?type=ws&security=tls&sni=test.com#Remote+Node';
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        text: async () => vlessUri,
      } as Response);
      (mockPrisma.externalNode.createMany as jest.Mock).mockResolvedValue({ count: 1 });
      const result = await svc.import('user-1', 'https://example.com/sub');
      expect(result.success).toBe(1);
      fetchSpy.mockRestore();
    });
  });

  describe('test', () => {
    it('throws NotFoundException when node not found', async () => {
      (mockPrisma.externalNode.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.test('bad-id', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when userId does not match', async () => {
      (mockPrisma.externalNode.findUnique as jest.Mock).mockResolvedValue({ ...fakeNode, userId: 'other-user' });
      await expect(svc.test('en-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('calls xrayTest for non-HYSTERIA2 protocol and persists result', async () => {
      (mockPrisma.externalNode.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      const testResult = { reachable: true, latency: 42, testedAt: new Date().toISOString() };
      (mockXrayTest.testWithParams as jest.Mock).mockResolvedValue(testResult);
      (mockPrisma.externalNode.update as jest.Mock).mockResolvedValue(fakeNode);

      const result = await svc.test('en-1', 'user-1');

      expect(mockXrayTest.testWithParams).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: 'VLESS', host: '1.2.3.4', port: 443 }),
      );
      expect(mockPrisma.externalNode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastReachable: true, lastLatency: 42 }) }),
      );
      expect(result).toBe(testResult);
    });

    it('calls singboxTest for HYSTERIA2 protocol', async () => {
      const hy2Node = { ...fakeNode, protocol: 'HYSTERIA2', password: 'secret', uuid: null };
      (mockPrisma.externalNode.findUnique as jest.Mock).mockResolvedValue(hy2Node);
      const testResult = { reachable: false, latency: null, testedAt: new Date().toISOString() };
      (mockSingboxTest.testHysteria2 as jest.Mock).mockResolvedValue(testResult);
      (mockPrisma.externalNode.update as jest.Mock).mockResolvedValue(hy2Node);

      await svc.test('en-1', 'user-1');

      expect(mockSingboxTest.testHysteria2).toHaveBeenCalled();
      expect(mockPrisma.externalNode.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastReachable: false, lastLatency: null }) }),
      );
    });

    it('passes credentials correctly (uuid, password, method)', async () => {
      const nodeWithAll = { ...fakeNode, password: 'pw', method: 'aes-256-gcm' };
      (mockPrisma.externalNode.findUnique as jest.Mock).mockResolvedValue(nodeWithAll);
      (mockXrayTest.testWithParams as jest.Mock).mockResolvedValue({ reachable: true, latency: 10, testedAt: new Date().toISOString() });
      (mockPrisma.externalNode.update as jest.Mock).mockResolvedValue(nodeWithAll);

      await svc.test('en-1', 'user-1');

      const call = (mockXrayTest.testWithParams as jest.Mock).mock.calls[0][0];
      expect(call.credentials).toMatchObject({ uuid: 'some-uuid', password: 'pw', method: 'aes-256-gcm' });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when node not found', async () => {
      (mockPrisma.externalNode.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.remove('bad-id', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when userId does not match', async () => {
      (mockPrisma.externalNode.findUnique as jest.Mock).mockResolvedValue({ ...fakeNode, userId: 'other-user' });
      await expect(svc.remove('en-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('deletes node when authorized', async () => {
      (mockPrisma.externalNode.findUnique as jest.Mock).mockResolvedValue(fakeNode);
      (mockPrisma.externalNode.delete as jest.Mock).mockResolvedValue(fakeNode);
      await svc.remove('en-1', 'user-1');
      expect(mockPrisma.externalNode.delete).toHaveBeenCalledWith({ where: { id: 'en-1' } });
    });
  });
});
