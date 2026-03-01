import { MetricsService } from './metrics.service';
import { PrismaService } from '../prisma.service';

const mockPrisma = {
  server: {
    count: jest.fn(),
    update: jest.fn(),
  },
  node: {
    count: jest.fn(),
  },
  serverMetric: {
    create: jest.fn(),
    findMany: jest.fn(),
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

      const result = await svc.getOverview();

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

      await svc.getOverview();

      const serverCountCalls = (mockPrisma.server.count as jest.Mock).mock.calls;
      // Second call should have the ONLINE filter
      expect(serverCountCalls[1][0]).toEqual({ where: { status: 'ONLINE' } });
    });

    it('queries running nodes with status RUNNING filter', async () => {
      (mockPrisma.server.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.node.count as jest.Mock).mockResolvedValue(0);

      await svc.getOverview();

      const nodeCountCalls = (mockPrisma.node.count as jest.Mock).mock.calls;
      expect(nodeCountCalls[1][0]).toEqual({ where: { status: 'RUNNING' } });
    });
  });

  describe('getServerMetrics', () => {
    it('returns metrics for specified server', async () => {
      const fakeMetrics = [{ id: 'm1', cpu: 50, mem: 60 }];
      (mockPrisma.serverMetric.findMany as jest.Mock).mockResolvedValue(fakeMetrics);

      const result = await svc.getServerMetrics('srv-1');

      expect(result).toBe(fakeMetrics);
      expect(mockPrisma.serverMetric.findMany).toHaveBeenCalledWith({
        where: { serverId: 'srv-1' },
        orderBy: { timestamp: 'desc' },
        take: 60,
      });
    });

    it('uses custom limit when provided', async () => {
      (mockPrisma.serverMetric.findMany as jest.Mock).mockResolvedValue([]);

      await svc.getServerMetrics('srv-1', 10);

      const call = (mockPrisma.serverMetric.findMany as jest.Mock).mock.calls[0][0];
      expect(call.take).toBe(10);
    });

    it('defaults to 60 data points', async () => {
      (mockPrisma.serverMetric.findMany as jest.Mock).mockResolvedValue([]);

      await svc.getServerMetrics('srv-2');

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

    it('updates server status to ONLINE with latest metrics', async () => {
      (mockPrisma.serverMetric.create as jest.Mock).mockResolvedValue({});
      (mockPrisma.server.update as jest.Mock).mockResolvedValue({});

      await svc.record('srv-1', 55, 80, 40, 500, 1000);

      const updateCall = (mockPrisma.server.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: 'srv-1' });
      expect(updateCall.data.status).toBe('ONLINE');
      expect(updateCall.data.cpuUsage).toBe(55);
      expect(updateCall.data.memUsage).toBe(80);
      expect(updateCall.data.diskUsage).toBe(40);
      expect(updateCall.data.lastSeenAt).toBeInstanceOf(Date);
    });
  });
});
