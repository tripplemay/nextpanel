import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { UsageProvisioner } from './usage-provisioner.service';
import { SubscriptionsController } from '../subscriptions/subscriptions.controller';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CfAccessService } from '../subscriptions/cf-access.service';
import { CfOptimizationService } from '../subscriptions/cf-optimization.service';

describe('usage authenticated HTTP boundary', () => {
  let app: INestApplication; let base: string; let jwt: JwtService;
  const usage = { overview: jest.fn().mockResolvedValue({ rows: [] }), history: jest.fn().mockResolvedValue([]) };
  const provisioner = { sync: jest.fn().mockResolvedValue({ prepared: true }) };
  const subscriptions = { setUsage: jest.fn().mockResolvedValue({ enabled: true }) };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: 'usage-isolated-http' })],
      controllers: [UsageController, SubscriptionsController], providers: [JwtStrategy,
        { provide: ConfigService, useValue: { getOrThrow: () => 'usage-isolated-http' } },
        { provide: AuthService, useValue: { validateById: async (id: string) =>
          ['owner', 'viewer'].includes(id) ? { id, role: id === 'viewer' ? 'VIEWER' : 'OPERATOR', tokenVersion: 0 } : null } },
        { provide: UsageService, useValue: usage }, { provide: UsageProvisioner, useValue: provisioner },
        { provide: SubscriptionsService, useValue: subscriptions },
        { provide: CfAccessService, useValue: {} }, { provide: CfOptimizationService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl(); jwt = module.get(JwtService);
  });
  afterAll(async () => app?.close());
  beforeEach(() => jest.clearAllMocks());
  const request = (path: string, user: string | null, body?: unknown) => fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${jwt.sign({ sub: user })}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  it.each([
    ['/usage', undefined], ['/usage/identity/history', undefined],
    ['/usage/nodes/node/prepare', { allowRestart: false }], ['/subscriptions/sub/usage', { enabled: true }],
  ])('denies anonymous and viewer access to %s', async (path, body) => {
    expect((await request(path as string, null, body)).status).toBe(401);
    expect((await request(path as string, 'viewer', body)).status).toBe(403);
    for (const fn of [usage.overview, usage.history, provisioner.sync, subscriptions.setUsage]) expect(fn).not.toHaveBeenCalled();
  });
  it('passes only the authenticated owner and explicit restart consent to services', async () => {
    expect((await request('/usage?subscriptionId=sub&ownerId=foreign', 'owner')).status).toBe(200);
    expect(usage.overview).toHaveBeenCalledWith('owner', 'sub');
    expect((await request('/usage/identity/history', 'owner')).status).toBe(200);
    expect(usage.history).toHaveBeenCalledWith('identity', 'owner');
    expect((await request('/usage/nodes/node/prepare', 'owner', { allowRestart: false })).status).toBe(201);
    expect(provisioner.sync).toHaveBeenCalledWith('node', 'owner', false);
    expect((await request('/subscriptions/sub/usage', 'owner', { enabled: true })).status).toBe(201);
    expect(subscriptions.setUsage).toHaveBeenCalledWith('sub', 'owner', true);
  });
  it.each([{}, { allowRestart: 'true' }, { allowRestart: null }, { allowRestart: true, ownerId: 'foreign' }])('rejects implicit or forged preparation consent %j', async body => {
    expect((await request('/usage/nodes/node/prepare', 'owner', body)).status).toBe(400);
    expect(provisioner.sync).not.toHaveBeenCalled();
  });
});
