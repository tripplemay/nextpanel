import { InviteCodesService } from './invite-codes.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  inviteCode: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
} as unknown as PrismaService;

const svc = new InviteCodesService(mockPrisma);

beforeEach(() => jest.clearAllMocks());

const fakeCode = { id: 'ic-1', code: 'ABC123', maxUses: 5, usedCount: 0, createdBy: 'admin-1', createdAt: new Date() };

describe('InviteCodesService', () => {
  describe('create', () => {
    it('creates the requested quantity and returns them', async () => {
      (mockPrisma.inviteCode.createMany as jest.Mock).mockResolvedValue({ count: 2 });
      (mockPrisma.inviteCode.findMany as jest.Mock).mockResolvedValue([fakeCode, fakeCode]);

      const result = await svc.create({ quantity: 2, maxUses: 5 }, 'admin-1');

      expect(mockPrisma.inviteCode.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ maxUses: 5, createdBy: 'admin-1' }),
        ]),
      });
      expect(result).toHaveLength(2);
    });

    it('passes maxUses to each created code', async () => {
      (mockPrisma.inviteCode.createMany as jest.Mock).mockResolvedValue({ count: 1 });
      (mockPrisma.inviteCode.findMany as jest.Mock).mockResolvedValue([fakeCode]);

      await svc.create({ quantity: 1, maxUses: 10 }, 'admin-1');

      const call = (mockPrisma.inviteCode.createMany as jest.Mock).mock.calls[0][0];
      expect(call.data[0].maxUses).toBe(10);
    });
  });

  describe('findAll', () => {
    it('returns all codes with creator username', async () => {
      (mockPrisma.inviteCode.findMany as jest.Mock).mockResolvedValue([fakeCode]);
      const result = await svc.findAll();
      expect(result).toEqual([fakeCode]);
      const call = (mockPrisma.inviteCode.findMany as jest.Mock).mock.calls[0][0];
      expect(call.include).toMatchObject({ creator: { select: { username: true } } });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when code does not exist', async () => {
      (mockPrisma.inviteCode.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.remove('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('deletes and returns the code when it exists', async () => {
      (mockPrisma.inviteCode.findUnique as jest.Mock).mockResolvedValue(fakeCode);
      (mockPrisma.inviteCode.delete as jest.Mock).mockResolvedValue(fakeCode);

      const result = await svc.remove('ic-1');
      expect(result).toBe(fakeCode);
      expect(mockPrisma.inviteCode.delete).toHaveBeenCalledWith({ where: { id: 'ic-1' } });
    });
  });
});
