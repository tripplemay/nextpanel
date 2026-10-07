import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';

describe('OAuth controller trust boundaries', () => {
  const auth = { verifyPassword: jest.fn(), wxWorkLogin: jest.fn(), wxWorkBind: jest.fn() };
  const provider = { getLoginUrl: jest.fn(), getUserByCode: jest.fn() };
  const states = { callbackUri: jest.fn(), issue: jest.fn(), consume: jest.fn() };
  const controller = new AuthController(auth as any, provider as any, states as any);
  beforeEach(() => {
    jest.resetAllMocks();
    states.callbackUri.mockReturnValue('https://panel.test/wxwork/callback');
    states.issue.mockResolvedValue('state');
    provider.getUserByCode.mockResolvedValue({ userId: 'wx-user', name: 'WX' });
  });
  it('rejects arbitrary redirects before issuing an authorization', async () => {
    await expect(controller.wxWorkLoginUrl('desktop', 'https://foreign.test', {} as any)).rejects.toThrow(BadRequestException);
    expect(states.issue).not.toHaveBeenCalled();
    expect(provider.getLoginUrl).not.toHaveBeenCalled();
  });
  it('requires password reauthentication before issuing a bind state', async () => {
    auth.verifyPassword.mockRejectedValue(new UnauthorizedException());
    await expect(controller.wxWorkBindUrl({ id: 'owner' }, { currentPassword: 'wrong' }, 'desktop', {} as any)).rejects.toThrow();
    expect(states.issue).not.toHaveBeenCalled();
    auth.verifyPassword.mockResolvedValue(undefined);
    await controller.wxWorkBindUrl({ id: 'owner' }, { currentPassword: 'correct' }, 'desktop', {} as any);
    expect(states.issue).toHaveBeenCalledWith('bind', {}, 'owner');
  });
  it('rejects invalid states before exchanging codes or mutating accounts', async () => {
    states.consume.mockRejectedValue(new BadRequestException());
    const dto = { code: 'code', state: 'invalid' };
    await expect(controller.wxWorkCallback(dto, {} as any, {} as any)).rejects.toThrow();
    await expect(controller.wxWorkBind({ id: 'owner' }, dto, {} as any, {} as any)).rejects.toThrow();
    expect(provider.getUserByCode).not.toHaveBeenCalled();
    expect(auth.wxWorkLogin).not.toHaveBeenCalled();
    expect(auth.wxWorkBind).not.toHaveBeenCalled();
  });
  it('uses separate one-time scopes for login and binding', async () => {
    const dto = { code: 'code', state: 'a'.repeat(64) };
    await controller.wxWorkCallback(dto, {} as any, {} as any);
    expect(states.consume).toHaveBeenCalledWith('login', dto.state, {}, {});
    await controller.wxWorkBind({ id: 'owner' }, dto, {} as any, {} as any);
    expect(states.consume).toHaveBeenLastCalledWith('bind', dto.state, {}, {}, 'owner');
    expect(auth.wxWorkBind).toHaveBeenCalledWith('owner', 'wx-user', 'WX');
  });
});
