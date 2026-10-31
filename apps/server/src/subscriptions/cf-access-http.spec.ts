import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { CfAccessService } from './cf-access.service';
import { CfOptimizationService } from './cf-optimization.service';

describe('CF access authenticated HTTP boundary', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const xray = { testWithParams: jest.fn().mockResolvedValue({ reachable: true, latency: 10, message: 'OK', testedAt: 'fixture' }) };
  const db = { node: { findFirst: jest.fn(async ({ where }) => where.id === 'node' && where.userId === 'owner' ? {
    id: 'node', protocol: 'VLESS', transport: 'WS', tls: 'TLS', listenPort: 443, cfDnsRecordId: 'record',
    domain: 'cdn.example.com', server: { ip: '192.0.2.1' }, exitType: null,
  } : null) } };
  const cf = new CfAccessService(db as any, { getCredentials: async () => ({ uuid: 'fixture' }) } as any, xray as any);
  const subscriptions = { create: jest.fn().mockResolvedValue({ id: 'created' }),
    update: jest.fn().mockResolvedValue({ id: 'updated' }),
    generateCfProvider: jest.fn().mockResolvedValue('proxies: []'),
    generateHomeProxyContentByShareToken: jest.fn().mockResolvedValue('{"fixture":true}') };
  const optimizer = { status: jest.fn().mockResolvedValue({ enabled: false }), rollback: jest.fn().mockResolvedValue({ paused: true }), resume: jest.fn().mockResolvedValue({ paused: false }) };
  beforeAll(async () => {
    cf.defaultIp = async () => '104.16.0.1';
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: 'cf-isolated-http' })],
      controllers: [SubscriptionsController],
      providers: [JwtStrategy,
        { provide: ConfigService, useValue: { getOrThrow: () => 'cf-isolated-http' } },
        { provide: AuthService, useValue: { validateById: async (id: string) =>
          ['owner', 'foreign', 'viewer'].includes(id) ? { id, role: id === 'viewer' ? 'VIEWER' : 'OPERATOR', tokenVersion: 0 } : null } },
        { provide: CfAccessService, useValue: cf },
        { provide: CfOptimizationService, useValue: optimizer },
        { provide: SubscriptionsService, useValue: subscriptions },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    jwt = module.get(JwtService);
  });
  afterAll(async () => { await app?.close(); });
  const check = (user: string | null, body: unknown) => fetch(`${base}/subscriptions/cf-access/check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${jwt.sign({ sub: user })}` } : {}) },
    body: JSON.stringify(body),
  });
  it('rejects anonymous, viewers and foreign owners without running a proxy', async () => {
    const body = { nodeId: 'node', ip: '104.16.0.1' };
    expect((await check(null, body)).status).toBe(401);
    expect((await check('viewer', body)).status).toBe(403);
    expect((await check('foreign', body)).status).toBe(404);
    expect(xray.testWithParams).not.toHaveBeenCalled();
  });
  it.each([
    { nodeId: 'node', ip: '127.0.0.1' }, { nodeId: 'node', ip: 'example.com' },
    { nodeId: 'node', ip: '104.16.0.1', ownerId: 'owner' }, { nodeId: '' },
  ])('rejects unsafe request %j', async (body) => {
    expect((await check('owner', body)).status).toBe(400);
  });
  it('returns only safe check/audit fields to the owner', async () => {
    const response = await check('owner', { nodeId: 'node', ip: '104.16.0.1' });
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ reachable: true, vantage: 'PANEL', address: '104.16.0.1', audit: { status: 'UNVERIFIED' } });
    expect(JSON.stringify(result)).not.toContain('192.0.2.1');
    expect(result).not.toHaveProperty('credentials');
  });
  it('rejects null/new DTO fields at the create boundary', async () => {
    const response = await fetch(`${base}/subscriptions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: 'owner' })}` },
      body: JSON.stringify({ name: 'bad', nodeIds: [], cfOnly: null }),
    });
    expect(response.status).toBe(400);
    expect(subscriptions.create).not.toHaveBeenCalled();
  });
  it('routes shared HomeProxy exports through the share-token service', async () => {
    const response = await fetch(`${base}/subscriptions/share/share-fixture/homeproxy`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(subscriptions.generateHomeProxyContentByShareToken).toHaveBeenCalledWith('share-fixture');
  });
  it.each([['', 'GET', 'status'], ['/rollback', 'POST', 'rollback'], ['/resume', 'POST', 'resume']] as const)(
    'protects optimization route %s and passes the authenticated owner', async (suffix, method, action) => {
      const url = `${base}/subscriptions/cf-access/optimization/node${suffix}`;
      expect((await fetch(url, { method })).status).toBe(401);
      expect((await fetch(url, { method, headers: { Authorization: `Bearer ${jwt.sign({ sub: 'viewer' })}` } })).status).toBe(403);
      expect((await fetch(url, { method, headers: { Authorization: `Bearer ${jwt.sign({ sub: 'owner' })}` } })).status).toBe(method === 'GET' ? 200 : 201);
      expect(optimizer[action]).toHaveBeenCalledWith('node', 'owner');
    });
  it('routes dynamic provider links with their own token scope and no-store', async () => {
    for (const [kind, tokenKey] of [['link', 'token'], ['share', 'shareToken']]) {
      const response = await fetch(`${base}/subscriptions/${kind}/fixture/cf-provider/node`);
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
      expect(subscriptions.generateCfProvider).toHaveBeenCalledWith({ [tokenKey]: 'fixture' }, 'node');
    }
  });
  it('accepts independent mixed auto mode but rejects client-controlled protection scopes', async () => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: 'owner' })}` };
    for (const [method, suffix, status] of [['POST', '', 201], ['PATCH', '/mixed', 200]] as const) {
      const body = { name: 'mixed', nodeIds: ['node', 'ordinary'], externalNodeIds: ['external'], cfOnly: false, cfAuto: true };
      expect((await fetch(`${base}/subscriptions${suffix}`, { method, headers, body: JSON.stringify(body) })).status).toBe(status);
      const action = method === 'POST' ? subscriptions.create : subscriptions.update;
      const count = action.mock.calls.length;
      expect((await fetch(`${base}/subscriptions${suffix}`, { method, headers,
        body: JSON.stringify({ ...body, cfProtectedNodeIds: [] }) })).status).toBe(400);
      expect(action).toHaveBeenCalledTimes(count);
    }
  });
});
