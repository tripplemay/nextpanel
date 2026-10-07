import { OAuthStateService } from './oauth-state.service';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

describe('OAuthStateService', () => {
  let svc: OAuthStateService;
  const rows = new Map<string, any>();
  const db = { oAuthState: {
    create: jest.fn(async ({ data }) => { rows.set(data.id, data); }),
    deleteMany: jest.fn(async ({ where }) => {
      const row = rows.get(where.id);
      if (!row || row.browserHash !== where.browserHash || row.purpose !== where.purpose ||
          row.userId !== where.userId || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
      rows.delete(where.id);
      return { count: 1 };
    }),
  } };
  const res = { cookie: jest.fn(), clearCookie: jest.fn(), setHeader: jest.fn() };
  const response = res as unknown as Response;
  const request = (cookie = '') => ({ headers: { cookie } } as Request);
  const cookie = () => `${res.cookie.mock.calls.at(-1)![0]}=${res.cookie.mock.calls.at(-1)![1]}`;
  beforeEach(() => {
    rows.clear(); jest.clearAllMocks();
    svc = new OAuthStateService(db as unknown as PrismaService,
      { getOrThrow: () => 'https://panel.test' } as unknown as ConfigService);
  });

  it('stores only hashes and uses a bounded, secure HttpOnly browser cookie', async () => {
    const state = await svc.issue('login', response);
    const row = [...rows.values()][0];
    expect(row.id).not.toBe(state);
    expect(row.browserHash).not.toBe(res.cookie.mock.calls[0][1]);
    expect(res.cookie).toHaveBeenCalledWith('np_wxwork_login', expect.any(String), {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/wxwork', maxAge: 300000,
    });
    expect(svc.callbackUri('login')).toBe('https://panel.test/wxwork/callback');
    expect(svc.callbackUri('bind')).toBe('https://panel.test/wxwork/bind-callback');
  });
  it('consumes exactly once even for concurrent callbacks', async () => {
    const state = await svc.issue('login', response);
    const req = request(cookie());
    const results = await Promise.allSettled([svc.consume('login', state, req, response), svc.consume('login', state, req, response)]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
  });
  it('rejects a stolen state from another browser without consuming the valid one', async () => {
    const state = await svc.issue('login', response);
    const ownCookie = cookie();
    await expect(svc.consume('login', state, request('np_wxwork_login=' + 'a'.repeat(64)), response)).rejects.toThrow();
    await expect(svc.consume('login', state, request(ownCookie), response)).resolves.toBeUndefined();
  });
  it('binds authorization to purpose and authenticated user', async () => {
    const state = await svc.issue('bind', response, 'owner');
    const req = request(cookie());
    await expect(svc.consume('bind', state, req, response, 'attacker')).rejects.toThrow();
    await expect(svc.consume('login', state, req, response)).rejects.toThrow();
    await expect(svc.consume('bind', state, req, response, 'owner')).resolves.toBeUndefined();
  });
  it('rejects expired, missing and malformed states', async () => {
    const state = await svc.issue('login', response);
    [...rows.values()][0].expiresAt = new Date(0);
    await expect(svc.consume('login', state, request(cookie()), response)).rejects.toThrow();
    await expect(svc.consume('login', state, request(), response)).rejects.toThrow();
    await expect(svc.consume('login', 'forged', request(cookie()), response)).rejects.toThrow();
    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});
