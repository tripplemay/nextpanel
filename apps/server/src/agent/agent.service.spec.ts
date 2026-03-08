import { AgentService } from './agent.service';
import { PrismaService } from '../prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { IpCheckService } from '../ip-check/ip-check.service';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

const mockPrisma = {
  server: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  node: {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn(),
  },
} as unknown as PrismaService;

const mockMetrics = {
  record: jest.fn().mockResolvedValue(undefined),
} as unknown as MetricsService;

const mockIpCheck = {
  getPendingTask: jest.fn().mockResolvedValue(null),
} as unknown as IpCheckService;

const mockConfig = {
  get: jest.fn().mockReturnValue('tripplemay/nextpanel-releases'),
} as unknown as ConfigService;

const svc = new AgentService(mockPrisma, mockMetrics, mockIpCheck, mockConfig);

const fakeServer = { id: 'srv-1', agentToken: 'tok-abc', pendingAgentUpdate: false };

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

      expect(result).toMatchObject({ ok: true });
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

    it('updates nodeTraffic when nodeTraffic payload is provided', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.node.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: 'v1',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
        nodeTraffic: [{ nodeId: 'n1', upBytes: 100, downBytes: 200 }],
      });

      expect(mockPrisma.node.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', serverId: 'srv-1' },
        data: { trafficUpBytes: 100, trafficDownBytes: 200 },
      });
    });

    it('delivers updateCommand but keeps flag set while agent is still on old version', async () => {
      const serverWithUpdate = { ...fakeServer, pendingAgentUpdate: true };
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(serverWithUpdate);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(serverWithUpdate);

      // getLatestVersion makes two fetches: GitHub releases API, then RELEASE_NOTES.md
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tag_name: 'v2.0.0' }) } as Response)
        .mockResolvedValueOnce({ ok: false } as Response); // RELEASE_NOTES.md not required

      // Agent reports old version — update is still in progress
      const result = await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: '1.4.0',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
      });

      // Command should be sent so agent can download
      expect(result.updateCommand).toMatchObject({
        version: '2.0.0',
        downloadUrl: expect.stringContaining('v2.0.0'),
      });
      // Flag must NOT be cleared — agent hasn't updated yet
      const updateCall = (mockPrisma.server.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('pendingAgentUpdate');
      fetchSpy.mockRestore();
    });

    it('clears pendingAgentUpdate flag after timeout even when command is being delivered (e.g. agent too old)', async () => {
      const freshSvc = new AgentService(mockPrisma, mockMetrics, mockIpCheck, mockConfig);
      const serverWithUpdate = { ...fakeServer, id: 'srv-timeout', pendingAgentUpdate: true };
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(serverWithUpdate);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(serverWithUpdate);
      (mockPrisma.node.findMany as jest.Mock).mockResolvedValue([]);

      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tag_name: 'v2.0.0' }) } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      // Backdate the pendingUpdateSince entry so elapsed > TIMEOUT
      (freshSvc as any).pendingUpdateSince.set('srv-timeout', Date.now() - 16 * 60 * 1000);

      const result = await freshSvc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: '1.4.0',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
      });

      // Timed out — no command, flag cleared
      expect(result.updateCommand).toBeUndefined();
      expect(mockPrisma.server.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pendingAgentUpdate: false }) }),
      );
      fetchSpy.mockRestore();
    });

    it('clears pendingAgentUpdate flag once agent reports the target version', async () => {
      const serverWithUpdate = { ...fakeServer, pendingAgentUpdate: true };
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(serverWithUpdate);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(serverWithUpdate);

      // getLatestVersion makes two fetches: GitHub releases API, then RELEASE_NOTES.md
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tag_name: 'v2.0.0' }) } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      // Agent reports the new version — update is complete
      const result = await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: '2.0.0',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
      });

      // No command needed — agent is already on the target version
      expect(result.updateCommand).toBeUndefined();
      // Flag should now be cleared
      expect(mockPrisma.server.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pendingAgentUpdate: false }) }),
      );
      fetchSpy.mockRestore();
    });

    it('returns ipCheckTask when pending task exists', async () => {
      (mockPrisma.server.findUnique as jest.Mock).mockResolvedValue(fakeServer);
      (mockPrisma.server.update as jest.Mock).mockResolvedValue(fakeServer);
      (mockIpCheck.getPendingTask as jest.Mock).mockResolvedValue({ serverId: 'srv-1' });

      const result = await svc.handleHeartbeat({
        agentToken: 'tok-abc', agentVersion: 'v1',
        cpu: 0, mem: 0, disk: 0, networkIn: 0, networkOut: 0,
      });

      expect(result.ipCheckTask).toEqual({ serverId: 'srv-1' });
    });
  });

  describe('getLatestVersion', () => {
    // getLatestVersion makes two fetches per call:
    //   1. GitHub releases API → JSON with tag_name
    //   2. RELEASE_NOTES.md   → plain text

    it('fetches version from GitHub API and release notes from RELEASE_NOTES.md', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tag_name: 'v1.5.0' }) } as Response)
        .mockResolvedValueOnce({ ok: true, text: async () => '## 1.5.0\n- New feature' } as Response);

      const freshSvc = new AgentService(mockPrisma, mockMetrics, mockIpCheck, mockConfig);
      const result = await freshSvc.getLatestVersion();

      expect(result.version).toBe('1.5.0');
      expect(result.releaseNotes).toContain('New feature');
      fetchSpy.mockRestore();
    });

    it('returns cached result within TTL without fetching again', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tag_name: 'v1.5.0' }) } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const freshSvc = new AgentService(mockPrisma, mockMetrics, mockIpCheck, mockConfig);
      await freshSvc.getLatestVersion();
      await freshSvc.getLatestVersion(); // second call should use cache

      expect(fetchSpy).toHaveBeenCalledTimes(2); // 2 fetches for the first call, 0 for the second
      fetchSpy.mockRestore();
    });

    it('returns empty version on fetch failure with no cache', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const freshSvc = new AgentService(mockPrisma, mockMetrics, mockIpCheck, mockConfig);
      const result = await freshSvc.getLatestVersion();

      expect(result.version).toBe('');
      fetchSpy.mockRestore();
    });

    it('strips leading "v" from tag_name', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tag_name: 'v3.0.0' }) } as Response)
        .mockResolvedValueOnce({ ok: false } as Response);

      const freshSvc = new AgentService(mockPrisma, mockMetrics, mockIpCheck, mockConfig);
      const result = await freshSvc.getLatestVersion();

      expect(result.version).toBe('3.0.0');
      fetchSpy.mockRestore();
    });
  });
});
