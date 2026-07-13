import { MetricsService } from './metrics.service';
import { PrismaService } from '../prisma.service';

const mockPrisma = {
  server: {
    count: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
  },
  node: {
    count: jest.fn(),
  },
  serverMetric: {
    create: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
} as unknown as PrismaService;

const svc = new MetricsService(mockPrisma);

beforeEach(() => jest.clearAllMocks());

describe('MetricsService', () => {
  describe('getOverview', () => {
    it('returns aggregated server and node counts', async () => {
      (mockPrisma.server.count as jest.Mock)
        .mockResolvedValueOnce(10)  // totalServers
        .mockResolvedValueOnce(7);  // onlineServers
      (mockPrisma.node.count as jest.Mock)
        .mockResolvedValueOnce(25) // totalNodes
        .mockResolvedValueOnce(20); // runningNodes

      const result = await svc.getOverview('user-1');

      expect(result).toEqual({
        totalServers: 10,
        onlineServers: 7,
        totalNodes: 25,
        runningNodes: 20,
      });
    });

    it('queries online servers with status ONLINE filter', async () => {
      (mockPrisma.server.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.node.count as jest.Mock).mockResolvedValue(0);

      await svc.getOverview('user-1');

      const serverCountCalls = (mockPrisma.server.count as jest.Mock).mock.calls;
      // Second call should have the ONLINE filter
      expect(serverCountCalls[1][0]).toEqual({ where: { userId: 'user-1', status: 'ONLINE' } });
    });

    it('queries running nodes with status RUNNING filter', async () => {
      (mockPrisma.server.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.node.count as jest.Mock).mockResolvedValue(0);

      await svc.getOverview('user-1');

      const nodeCountCalls = (mockPrisma.node.count as jest.Mock).mock.calls;
      expect(nodeCountCalls[1][0]).toEqual({ where: { userId: 'user-1', status: 'RUNNING' } });
    });
  });

  describe('getServerMetrics', () => {
    it('returns metrics for specified server', async () => {
      const fakeMetrics = [{ id: 'm1', cpu: 50, mem: 60 }];
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue({ id: 'srv-1' });
      (mockPrisma.serverMetric.findMany as jest.Mock).mockResolvedValue(fakeMetrics);

      const result = await svc.getServerMetrics('srv-1', 'user-1');

      expect(result).toBe(fakeMetrics);
      expect(mockPrisma.serverMetric.findMany).toHaveBeenCalledWith({
        where: { serverId: 'srv-1' },
        orderBy: { timestamp: 'desc' },
        take: 60,
      });
    });

    it('uses custom limit when provided', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue({ id: 'srv-1' });
      (mockPrisma.serverMetric.findMany as jest.Mock).mockResolvedValue([]);

      await svc.getServerMetrics('srv-1', 'user-1', 10);

      const call = (mockPrisma.serverMetric.findMany as jest.Mock).mock.calls[0][0];
      expect(call.take).toBe(10);
    });

    it('defaults to 60 data points', async () => {
      (mockPrisma.server.findFirst as jest.Mock).mockResolvedValue({ id: 'srv-2' });
      (mockPrisma.serverMetric.findMany as jest.Mock).mockResolvedValue([]);

      await svc.getServerMetrics('srv-2', 'user-1');

      const call = (mockPrisma.serverMetric.findMany as jest.Mock).mock.calls[0][0];
      expect(call.take).toBe(60);
    });
  });

  describe('record', () => {
    it('creates a server metric record', async () => {
      (mockPrisma.serverMetric.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.server.update as jest.Mock).mockResolvedValue({});

      await svc.record('srv-1', 45, 70, 30, 100, 200);

      expect(mockPrisma.serverMetric.create).toHaveBeenCalledWith({
        data: {
          serverId: 'srv-1',
          cpu: 45,
          mem: 70,
          disk: 30,
          networkIn: 100,
          networkOut: 200,
        },
      });
    });

    it('does not write server status (the agent heartbeat owns that write)', async () => {
      (mockPrisma.serverMetric.create as jest.Mock).mockResolvedValue({});

      await svc.record('srv-1', 55, 80, 40, 500, 1000);

      // record() only inserts a time-series data point. Server status/lastSeenAt/usage
      // is written by AgentService.handleHeartbeat — doing it here too was a duplicate
      // write and was removed.
      expect(mockPrisma.server.update).not.toHaveBeenCalled();
    });
  });

  describe('pruneOldMetrics', () => {
    it('deletes ServerMetric rows older than the retention window', async () => {
      (mockPrisma.serverMetric.deleteMany as jest.Mock).mockResolvedValue({ count: 42 });
      const now = new Date('2026-07-13T00:00:00.000Z');

      const deleted = await svc.pruneOldMetrics(14, now);

      expect(deleted).toBe(42);
      expect(mockPrisma.serverMetric.deleteMany).toHaveBeenCalledWith({
        where: { timestamp: { lt: new Date('2026-06-29T00:00:00.000Z') } },
      });
    });

    it('honours a custom retention window', async () => {
      (mockPrisma.serverMetric.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      const now = new Date('2026-07-13T00:00:00.000Z');

      await svc.pruneOldMetrics(30, now);

      const call = (mockPrisma.serverMetric.deleteMany as jest.Mock).mock.calls[0][0];
      expect(call.where.timestamp.lt).toEqual(new Date('2026-06-13T00:00:00.000Z'));
    });

    it('falls back to 14 days when retentionDays is invalid (guards against wiping all data)', async () => {
      (mockPrisma.serverMetric.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
      const now = new Date('2026-07-13T00:00:00.000Z');

      await svc.pruneOldMetrics(0, now);

      const call = (mockPrisma.serverMetric.deleteMany as jest.Mock).mock.calls[0][0];
      expect(call.where.timestamp.lt).toEqual(new Date('2026-06-29T00:00:00.000Z'));
    });
  });
});
