import { AuditService } from './audit.service';
import { PrismaService } from '../prisma.service';
import { AuditAction } from '@prisma/client';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
} as unknown as PrismaService;

const svc = new AuditService(mockPrisma);

beforeEach(() => jest.clearAllMocks());

describe('AuditService', () => {
  describe('log', () => {
    it('creates audit log with all params', async () => {
      const fakeLog = { id: 'log-1' };
      (mockPrisma.auditLog.create as jest.Mock).mockResolvedValue(fakeLog);

      const result = await svc.log({
        actorId: 'user-1',
        action: 'CREATE' as AuditAction,
        resource: 'server',
        resourceId: 'srv-1',
        diff: { name: 'My Server' },
        ip: '127.0.0.1',
      });

      expect(result).toBe(fakeLog);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'user-1',
          action: 'CREATE',
          resource: 'server',
          resourceId: 'srv-1',
          diff: { name: 'My Server' },
          ip: '127.0.0.1',
        },
      });
    });

    it('creates audit log with optional fields omitted', async () => {
      (mockPrisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-2' });

      await svc.log({
        actorId: 'user-1',
        action: 'DELETE' as AuditAction,
        resource: 'node',
      });

      const data = (mockPrisma.auditLog.create as jest.Mock).mock.calls[0][0].data;
      expect(data.resourceId).toBeUndefined();
      expect(data.diff).toBeUndefined();
      expect(data.ip).toBeUndefined();
    });

    it('supports UPDATE action', async () => {
      (mockPrisma.auditLog.create as jest.Mock).mockResolvedValue({ id: 'log-3' });

      await svc.log({
        actorId: 'u2',
        action: 'UPDATE' as AuditAction,
        resource: 'template',
        resourceId: 'tpl-1',
        diff: { before: 'old', after: 'new' },
      });

      const data = (mockPrisma.auditLog.create as jest.Mock).mock.calls[0][0].data;
      expect(data.action).toBe('UPDATE');
      expect(data.diff).toEqual({ before: 'old', after: 'new' });
    });
  });

  describe('findAll', () => {
    const fakeLogs = [{ id: 'log-1', actor: { username: 'admin' } }];

    it('returns data, total, page, and pageSize', async () => {
      (mockPrisma.auditLog.findMany as jest.Mock).mockResolvedValue(fakeLogs);
      (mockPrisma.auditLog.count as jest.Mock).mockResolvedValue(42);

      const result = await svc.findAll(1, 20);

      expect(result.data).toBe(fakeLogs);
      expect(result.total).toBe(42);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('applies default page=1 and pageSize=20', async () => {
      (mockPrisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.auditLog.count as jest.Mock).mockResolvedValue(0);

      await svc.findAll();

      const call = (mockPrisma.auditLog.findMany as jest.Mock).mock.calls[0][0];
      expect(call.skip).toBe(0);
      expect(call.take).toBe(20);
    });

    it('calculates correct skip for page 3', async () => {
      (mockPrisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.auditLog.count as jest.Mock).mockResolvedValue(0);

      await svc.findAll(3, 10);

      const call = (mockPrisma.auditLog.findMany as jest.Mock).mock.calls[0][0];
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
    });

    it('orders by timestamp descending and includes actor username', async () => {
      (mockPrisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.auditLog.count as jest.Mock).mockResolvedValue(0);

      await svc.findAll();

      const call = (mockPrisma.auditLog.findMany as jest.Mock).mock.calls[0][0];
      expect(call.orderBy).toEqual({ timestamp: 'desc' });
      expect(call.include).toEqual({ actor: { select: { username: true } } });
    });
  });
});
