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
  const subscriptions = { create: jest.fn().mockResolvedValue({ id: 'created' }), generateHomeProxyContentByShareToken: jest.fn().mockResolvedValue('{"fixture":true}') };
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
});
