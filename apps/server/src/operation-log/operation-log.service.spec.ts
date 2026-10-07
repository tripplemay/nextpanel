import { OperationLogService } from './operation-log.service';
import { PrismaService } from '../prisma.service';

const mockPrisma = {
  node: { findUnique: jest.fn() },
  server: { findUnique: jest.fn() },
  operationLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
} as unknown as PrismaService;

const svc = new OperationLogService(mockPrisma);
const user = { id: 'user-1', role: 'OPERATOR' };

const baseParams = {
  ownerId: 'user-1',
  resourceType: 'node',
  resourceId: 'node-1',
  resourceName: 'SG01',
  actorId: 'user-1',
  operation: 'DEPLOY',
  correlationId: 'corr-123',
  success: true,
  log: 'deploy output',
  durationMs: 3000,
};

beforeEach(() => jest.clearAllMocks());

describe('OperationLogService', () => {
  it('captures the resource owner even for background jobs with no actor', async () => {
    (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue({ userId: 'owner' });
    await svc.createLog({ ...baseParams, ownerId: undefined, actorId: null });
    expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({ data: { ...baseParams, ownerId: 'owner', actorId: null } });
  });
  it('does not assign unresolvable historical ownership to the actor', async () => {
    (mockPrisma.node.findUnique as jest.Mock).mockResolvedValue(null);
    await svc.createLog({ ...baseParams, ownerId: undefined });
    expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({ data: { ...baseParams, ownerId: null } });
  });
  it('allows administrators to read orphaned logs', async () => {
    await svc.getLog('orphan', { id: 'admin', role: 'ADMIN' });
    expect(mockPrisma.operationLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'orphan' } }));
  });
  describe('createLog', () => {
    it('delegates to prisma.operationLog.create with all params', async () => {
      const fakeRecord = { id: 'log-1', ...baseParams, createdAt: new Date() };
      (mockPrisma.operationLog.create as jest.Mock).mockResolvedValue(fakeRecord);

      const result = await svc.createLog(baseParams);

      expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({ data: baseParams });
      expect(result).toBe(fakeRecord);
    });

    it('handles nullable fields (resourceId, actorId, correlationId, log, durationMs)', async () => {
      const nullableParams = {
        ...baseParams,
        resourceId: null,
        actorId: null,
        correlationId: null,
        log: null,
        durationMs: null,
      };
      (mockPrisma.operationLog.create as jest.Mock).mockResolvedValue({ id: 'log-2', ...nullableParams });

      await svc.createLog(nullableParams);

      expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({ data: nullableParams });
    });
  });

  describe('listByResource', () => {
    it('queries by resourceType and resourceId, ordered by createdAt desc', async () => {
      (mockPrisma.operationLog.findMany as jest.Mock).mockResolvedValue([]);

      await svc.listByResource('node', 'node-1', user);

      expect(mockPrisma.operationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { resourceType: 'node', resourceId: 'node-1', ownerId: user.id },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('uses default limit of 20', async () => {
      (mockPrisma.operationLog.findMany as jest.Mock).mockResolvedValue([]);

      await svc.listByResource('node', 'node-1', user);

      expect(mockPrisma.operationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });

    it('respects custom limit', async () => {
      (mockPrisma.operationLog.findMany as jest.Mock).mockResolvedValue([]);

      await svc.listByResource('server', 'srv-1', user, 5);

      expect(mockPrisma.operationLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('excludes log field in the select', async () => {
      (mockPrisma.operationLog.findMany as jest.Mock).mockResolvedValue([]);

      await svc.listByResource('node', 'node-1', user);

      const call = (mockPrisma.operationLog.findMany as jest.Mock).mock.calls[0][0];
      expect(call.select.log).toBeUndefined();
    });
  });

  describe('getByCorrelationId', () => {
    it('returns the first matching record by correlationId', async () => {
      const fakeLog = { id: 'log-1', correlationId: 'corr-123', log: 'output' };
      (mockPrisma.operationLog.findFirst as jest.Mock).mockResolvedValue(fakeLog);

      const result = await svc.getByCorrelationId('corr-123', user);

      expect(mockPrisma.operationLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { correlationId: 'corr-123', ownerId: user.id } }),
      );
      expect(result).toBe(fakeLog);
    });

    it('includes log field in select for UI display', async () => {
      (mockPrisma.operationLog.findFirst as jest.Mock).mockResolvedValue(null);

      await svc.getByCorrelationId('corr-abc', user);

      const call = (mockPrisma.operationLog.findFirst as jest.Mock).mock.calls[0][0];
      expect(call.select.log).toBe(true);
    });

    it('returns null when no record matches', async () => {
      (mockPrisma.operationLog.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await svc.getByCorrelationId('nonexistent', user);

      expect(result).toBeNull();
    });
  });

  describe('getLog', () => {
    it('queries by id and returns record with log text', async () => {
      const fakeLog = { id: 'log-1', log: 'full output here', success: true };
      (mockPrisma.operationLog.findFirst as jest.Mock).mockResolvedValue(fakeLog);

      const result = await svc.getLog('log-1', user);

      expect(mockPrisma.operationLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'log-1', ownerId: user.id } }),
      );
      expect(result).toBe(fakeLog);
    });

    it('includes log field in select', async () => {
      (mockPrisma.operationLog.findFirst as jest.Mock).mockResolvedValue(null);

      await svc.getLog('log-2', user);

      const call = (mockPrisma.operationLog.findFirst as jest.Mock).mock.calls[0][0];
      expect(call.select.log).toBe(true);
    });

    it('returns null when record not found', async () => {
      (mockPrisma.operationLog.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await svc.getLog('missing', user);

      expect(result).toBeNull();
    });
  });
});
