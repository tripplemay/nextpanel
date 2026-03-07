import { UsersService } from './users.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

const mockPrisma = {
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
} as unknown as PrismaService;

const svc = new UsersService(mockPrisma);

beforeEach(() => jest.clearAllMocks());

const fakeUser = { id: 'u1', username: 'alice', role: 'OPERATOR' as UserRole, createdAt: new Date() };
const adminUser = { id: 'a1', username: 'admin', role: 'ADMIN' as UserRole, createdAt: new Date() };

describe('UsersService', () => {
  describe('findAll', () => {
    it('returns all users ordered by createdAt', async () => {
      (mockPrisma.user.findMany as jest.Mock).mockResolvedValue([fakeUser]);
      const result = await svc.findAll();
      expect(result).toEqual([fakeUser]);
      const call = (mockPrisma.user.findMany as jest.Mock).mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'asc' });
      expect(call.select).toMatchObject({ id: true, username: true, role: true, createdAt: true });
    });
  });

  describe('updateRole', () => {
    it('throws ForbiddenException when requester tries to change own role', async () => {
      await expect(svc.updateRole('u1', 'ADMIN', 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.updateRole('u2', 'ADMIN', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when target is an ADMIN', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(adminUser);
      await expect(svc.updateRole('a1', 'OPERATOR', 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('updates role and returns safe user info', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({ ...fakeUser, role: 'ADMIN' });

      const result = await svc.updateRole('u1', 'ADMIN', 'requester-id');

      expect(result).toMatchObject({ role: 'ADMIN' });
      const call = (mockPrisma.user.update as jest.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ id: 'u1' });
      expect(call.data).toEqual({ role: 'ADMIN' });
    });
  });

  describe('remove', () => {
    it('throws ForbiddenException when requester tries to delete themselves', async () => {
      await expect(svc.remove('u1', 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.remove('u2', 'u1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when deleting the last ADMIN', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(adminUser);
      (mockPrisma.user.count as jest.Mock).mockResolvedValue(1);
      await expect(svc.remove('a1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('allows deleting an ADMIN when more than one ADMIN exists', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(adminUser);
      (mockPrisma.user.count as jest.Mock).mockResolvedValue(2);
      (mockPrisma.user.delete as jest.Mock).mockResolvedValue(adminUser);

      const result = await svc.remove('a1', 'u1');
      expect(result).toBe(adminUser);
    });

    it('deletes a non-ADMIN user without checking admin count', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      (mockPrisma.user.delete as jest.Mock).mockResolvedValue(fakeUser);

      const result = await svc.remove('u1', 'requester-id');

      expect(result).toBe(fakeUser);
      expect(mockPrisma.user.count).not.toHaveBeenCalled();
    });
  });
});
