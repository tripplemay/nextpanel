import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JWT session versions', () => {
  const auth = { isTokenRevoked: jest.fn(), validateById: jest.fn() };
  const strategy = new JwtStrategy({ getOrThrow: () => 'test-secret' } as any, auth as any);
  beforeEach(() => {
    jest.resetAllMocks();
    auth.isTokenRevoked.mockResolvedValue(false);
    auth.validateById.mockResolvedValue({ id: 'owner', role: 'VIEWER', tokenVersion: 0 });
  });

  it('accepts legacy JWTs only until the first account-level revocation', async () => {
    await expect(strategy.validate({ sub: 'owner', role: 'ADMIN' })).resolves.toMatchObject({ role: 'VIEWER' });
    auth.validateById.mockResolvedValue({ id: 'owner', role: 'VIEWER', tokenVersion: 1 });
    await expect(strategy.validate({ sub: 'owner', role: 'ADMIN' })).rejects.toThrow(UnauthorizedException);
    await expect(strategy.validate({ sub: 'owner', role: 'ADMIN', tokenVersion: 1 })).resolves.toMatchObject({ role: 'VIEWER' });
  });

  it.each([null, -1, 0.5, '0', 1, Number.MAX_SAFE_INTEGER + 1])('rejects invalid or stale versions: %s', tokenVersion => {
    return expect(strategy.validate({ sub: 'owner', role: 'VIEWER', tokenVersion } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('preserves per-JTI logout and rejects deleted users', async () => {
    auth.isTokenRevoked.mockResolvedValue(true);
    await expect(strategy.validate({ sub: 'owner', role: 'VIEWER', jti: 'revoked' })).rejects.toThrow(UnauthorizedException);
    expect(auth.validateById).not.toHaveBeenCalled();
    auth.validateById.mockResolvedValue(null);
    await expect(strategy.validate({ sub: 'owner', role: 'VIEWER' })).rejects.toThrow(UnauthorizedException);
  });
});
