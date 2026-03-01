import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');
const bcryptCompare = bcrypt.compare as jest.Mock;
const bcryptHash = bcrypt.hash as jest.Mock;

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
} as unknown as PrismaService;

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock-token'),
} as unknown as JwtService;

const svc = new AuthService(mockPrisma, mockJwt);

const fakeUser = {
  id: 'u1', username: 'admin', passwordHash: 'hashed', role: 'ADMIN',
};

beforeEach(() => jest.clearAllMocks());

describe('AuthService', () => {
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

      expect(mockJwt.sign).toHaveBeenCalledWith({ sub: 'u1', role: 'ADMIN' });
    });
  });

  describe('register', () => {
    it('creates a new user and returns safe user info', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      bcryptHash.mockResolvedValue('hashed-pw');
      (mockPrisma.user.create as jest.Mock).mockResolvedValue(fakeUser);

      const result = await svc.register({ username: 'admin', password: 'pw' });

      expect(result.id).toBe('u1');
      expect(result.username).toBe('admin');
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('throws ConflictException when username is taken', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(fakeUser);

      await expect(svc.register({ username: 'admin', password: 'pw' }))
        .rejects.toThrow(ConflictException);
    });

    it('defaults role to VIEWER when not provided', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      bcryptHash.mockResolvedValue('h');
      (mockPrisma.user.create as jest.Mock).mockResolvedValue({ ...fakeUser, role: 'VIEWER' });

      await svc.register({ username: 'new', password: 'pw' });

      const createArg = (mockPrisma.user.create as jest.Mock).mock.calls[0][0];
      expect(createArg.data.role).toBe('VIEWER');
    });

    it('hashes password with bcrypt (salt=12)', async () => {
      (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      bcryptHash.mockResolvedValue('hashed');
      (mockPrisma.user.create as jest.Mock).mockResolvedValue(fakeUser);

      await svc.register({ username: 'x', password: 'mypassword' });

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
});
