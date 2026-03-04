import { AgentService } from './agent.service';
import { PrismaService } from '../prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { UnauthorizedException } from '@nestjs/common';

const mockPrisma = {
  server: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  node: {
    updateMany: jest.fn(),
  },
} as unknown as PrismaService;

const mockMetrics = {
  record: jest.fn().mockResolvedValue(undefined),
} as unknown as MetricsService;

const svc = new AgentService(mockPrisma, mockMetrics);

const fakeServer = { id: 'srv-1', agentToken: 'tok-abc' };

beforeEach(() => jest.clearAllMocks());

describe('AgentService', () => {
  describe('handleHeartbeat', () => {
    it('returns { ok: true } on valid token', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      const result = await svc.handleHeartbeat({
        agentToken: 'tok-abc',
        agentVersion: 'v1.2.0',
        cpu: 30, mem: 50, disk: 20, networkIn: 100, networkOut: 200,
      });

      expect(result).toEqual({ ok: true });
    });

    it('throws UnauthorizedException for unknown agent token', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.handleHeartbeat({
        agentToken: 'bad-token',
        agentVersion: 'v1',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
      })).rejects.toThrow(UnauthorizedException);
    });

    it('updates agentVersion on the server', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: 'v2.0.0',
        cpu: 10, mem: 20, disk: 30, networkIn: 0, networkOut: 0,
      });

      expect(mockPrisma.server.update).toHaveBeenCalledWith({
        where: { id: 'srv-1' },
        data: expect.objectContaining({ agentVersion: 'v2.0.0' }),
      });
    });

    it('calls metricsService.record with correct values', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      // First call establishes the previous network baseline
      await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: 'v1',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
      });
      jest.clearAllMocks();
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      // Second call: delta = 10240 bytes over 10s → rate = 1024 bytes/s; delta = 20480 → 2048/s
      await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: 'v1',
        cpu: 55, mem: 70, disk: 40, networkIn: 10240, networkOut: 20480,
      });

      expect(mockMetrics.record).toHaveBeenCalledWith('srv-1', 55, 70, 40, 1024, 2048);
    });

    it('updates node statuses when nodeStatuses provided', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.node.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: 'v1',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
        nodeStatuses: [
          { nodeId: 'n1', status: 'RUNNING' },
          { nodeId: 'n2', status: 'STOPPED' },
        ],
      });

      expect(mockPrisma.node.updateMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.node.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', serverId: 'srv-1' },
        data: { status: 'RUNNING' },
      });
      expect(mockPrisma.node.updateMany).toHaveBeenCalledWith({
        where: { id: 'n2', serverId: 'srv-1' },
        data: { status: 'STOPPED' },
      });
    });

    it('skips node status update when nodeStatuses not provided', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);

      await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: 'v1',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
      });

      expect(mockPrisma.node.updateMany).not.toHaveBeenCalled();
    });
  });
});
