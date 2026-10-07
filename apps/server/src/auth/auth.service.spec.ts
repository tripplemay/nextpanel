import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import type { ChangePasswordDto } from './dto/change-password.dto';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');
const bcryptCompare = bcrypt.compare as jest.Mock;
const bcryptHash = bcrypt.hash as jest.Mock;

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  inviteCode: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
} as unknown as PrismaService;

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock-token'),
} as unknown as JwtService;

const svc = new AuthService(mockPrisma, mockJwt);

const fakeUser = {
  id: 'u1', username: 'admin', passwordHash: 'hashed', role: 'ADMIN', tokenVersion: 0,
};

const fakeInvite = { id: 'inv1', code: 'valid-code', maxUses: 5, usedCount: 2 };

beforeEach(() => jest.clearAllMocks());

describe('AuthService', () => {
  it('requires the current password before creating an OAuth binding authorization', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
    bcryptCompare.mockResolvedValue(false);
    await expect(svc.verifyPassword('u1', 'wrong')).rejects.toThrow(UnauthorizedException);
    bcryptCompare.mockResolvedValue(true);
    await expect(svc.verifyPassword('u1', 'correct')).resolves.toBeUndefined();
    expect(bcryptCompare).toHaveBeenLastCalledWith('correct', 'hashed');
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(svc.verifyPassword('missing', 'correct')).rejects.toThrow(UnauthorizedException);
  });
  describe('login', () => {
    it('returns accessToken and user info on success', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(true);

      const result = await svc.login({ username: 'admin', password: 'correct' });

      expect(result.accessToken).toBe('mock-token');
      expect(result.user.id).toBe('u1');
      expect(result.user.username).toBe('admin');
      expect(result.user.role).toBe('ADMIN');
    });

    it('throws UnauthorizedException when user is not found', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      bcryptCompare.mockResolvedValue(false);

      await expect(svc.login({ username: 'nobody', password: 'pw' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password is wrong', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(false);

      await expect(svc.login({ username: 'admin', password: 'wrong' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('signs JWT with sub and role in payload', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(true);

      await svc.login({ username: 'admin', password: 'correct' });

      expect(mockJwt.sign).toHaveBeenCalledWith(expect.objectContaining({ sub: 'u1', role: 'ADMIN', tokenVersion: 0 }));
    });
  });

  describe('register', () => {
    it('creates a new user with OPERATOR role and returns safe user info', async () => {
      (mockPrisma.inviteCode.findUnique as jest.Mock).mockResolvedValue(fakeInvite);
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      bcryptHash.mockResolvedValue('hashed-pw');
      const newUser = { ...fakeUser, role: 'OPERATOR' };
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([newUser, {}]);

      const result = await svc.register({ username: 'newuser', password: 'mypassword', inviteCode: 'valid-code' });

      expect(result.id).toBe('u1');
      expect(result.role).toBe('OPERATOR');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws BadRequestException when invite code is invalid', async () => {
      (mockPrisma.inviteCode.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.register({ username: 'x', password: 'mypassword', inviteCode: 'bad-code' }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when invite code is exhausted', async () => {
      (mockPrisma.inviteCode.findUnique as jest.Mock).mockResolvedValue({ ...fakeInvite, maxUses: 1, usedCount: 1 });

      await expect(svc.register({ username: 'x', password: 'mypassword', inviteCode: 'used-code' }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when username is taken', async () => {
      (mockPrisma.inviteCode.findUnique as jest.Mock).mockResolvedValue(fakeInvite);
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);

      await expect(svc.register({ username: 'admin', password: 'mypassword', inviteCode: 'valid-code' }))
        .rejects.toThrow(ConflictException);
    });

    it('hashes password with bcrypt (salt=12)', async () => {
      (mockPrisma.inviteCode.findUnique as jest.Mock).mockResolvedValue(fakeInvite);
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      bcryptHash.mockResolvedValue('hashed');
      (mockPrisma.$transaction as jest.Mock).mockResolvedValue([fakeUser, {}]);

      await svc.register({ username: 'x', password: 'mypassword', inviteCode: 'valid-code' });

      expect(bcryptHash).toHaveBeenCalledWith('mypassword', 12);
    });
  });

  describe('validateById', () => {
    it('returns user when found', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      await expect(svc.validateById('u1')).resolves.toBe(fakeUser);
    });

    it('returns null when user is not found', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.validateById('missing')).resolves.toBeNull();
    });
  });

  describe('changePassword', () => {
    const dto: ChangePasswordDto = { currentPassword: 'old', newPassword: 'new' };

    it('throws UnauthorizedException when user is not found', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.changePassword('u1', dto, 0)).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when current password is wrong', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(false);
      await expect(svc.changePassword('u1', dto, 0)).rejects.toThrow(BadRequestException);
    });

    it('updates password hash when credentials are valid', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(true);
      bcryptHash.mockResolvedValue('new-hash');
      (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await svc.changePassword('u1', dto, 0);

      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', passwordHash: 'hashed', tokenVersion: 0 },
        data: { passwordHash: 'new-hash', tokenVersion: { increment: 1 } },
      });
    });

    it('rejects a session revoked between guard and password change', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ ...fakeUser, tokenVersion: 1 });
      await expect(svc.changePassword('u1', dto, 0)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a concurrent password or session update without overwriting it', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(true);
      bcryptHash.mockResolvedValue('new-hash');
      (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      await expect(svc.changePassword('u1', dto, 0)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('revokeOtherSessions', () => {
    it('requires the current password and never updates on failure', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(false);
      await expect(svc.revokeOtherSessions('u1', 'wrong', 0)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('increments the version and issues only the caller a replacement JWT', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(true);
      (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      expect((await svc.revokeOtherSessions('u1', 'correct', 0)).accessToken).toBe('mock-token');
      expect(mockJwt.sign).toHaveBeenCalledWith(expect.objectContaining({ tokenVersion: 1 }));
    });

    it('never signs a replacement when the concurrent CAS loses', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);
      bcryptCompare.mockResolvedValue(true);
      (mockPrisma.user.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      await expect(svc.revokeOtherSessions('u1', 'correct', 0)).rejects.toThrow(UnauthorizedException);
      expect(mockJwt.sign).not.toHaveBeenCalled();
    });
  });

  it('includes the current version in enterprise WeChat login', async () => {
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ ...fakeUser, tokenVersion: 7 });
    await svc.wxWorkLogin('wx-user', 'Name');
    expect(mockJwt.sign).toHaveBeenCalledWith(expect.objectContaining({ tokenVersion: 7 }));
  });
});
