import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtStrategy } from './auth/jwt.strategy';
import { OAuthStateService } from './auth/oauth-state.service';
import { WxWorkService } from './wxwork/wxwork.service';
import { PrismaService } from './prisma.service';
import { ExternalNodesController } from './external-nodes/external-nodes.controller';
import { ExternalNodesService } from './external-nodes/external-nodes.service';
import { CryptoService } from './common/crypto/crypto.service';
import { sealExternalSecrets } from './external-nodes/external-credentials';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuditService } from './audit/audit.service';

describe('security closeout real HTTP (stateful isolated persistence)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const users = new Map<string, any>();
  const audit = { log: jest.fn() };
  const cipher = new CryptoService({ getOrThrow: () => 'ab'.repeat(32) } as any);
  const node = { id: 'ext', userId: 'owner', name: 'private node', protocol: 'HTTP', address: 'proxy.test', port: 80,
    uuid: null, username: null, password: null, rawUri: null, xhttpExtra: null,
    credentialsEnc: sealExternalSecrets(cipher, 'owner', { username: 'proxy-user', password: 'proxy-secret', rawUri: 'http://proxy-user:proxy-secret@proxy.test' }) };
  const select = (value: any, fields: Record<string, unknown>) => Object.fromEntries(Object.keys(fields).map(key => [key, value[key]]));
  const db = {
    user: {
      findUnique: jest.fn(async ({ where }) => {
        const user = users.get(where.id ?? where.username);
        return user ? { ...user } : null;
      }),
      update: jest.fn(async ({ where, data }) => Object.assign(users.get(where.id), data)),
      updateMany: jest.fn(async ({ where, data }) => {
        const user = users.get(where.id);
        if (!user || user.passwordHash !== where.passwordHash || user.tokenVersion !== where.tokenVersion) return { count: 0 };
        if (data.passwordHash) user.passwordHash = data.passwordHash;
        user.tokenVersion++;
        return { count: 1 };
      }),
    },
    revokedToken: { findUnique: async () => null },
    externalNode: {
      findMany: jest.fn(async ({ where, select: fields }) => where.userId === node.userId ? [select(node, fields)] : []),
      findFirst: jest.fn(async ({ where }) => where.id === node.id && where.userId === node.userId ? node : null),
      findUnique: jest.fn(async ({ where }) => where.id === node.id ? node : null),
      update: jest.fn(async ({ data, select: fields }) => select({ ...node, ...data }, fields)),
    },
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('current-password', 4);
    for (const id of ['owner', 'foreign', 'admin']) users.set(id, { id, username: id, passwordHash, tokenVersion: 0, loginAttempts: 0, role: id === 'admin' ? 'ADMIN' : 'OPERATOR' });
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: 'isolated-closeout', signOptions: { expiresIn: '1h' } }), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [AuthController, ExternalNodesController],
      providers: [AuthService, JwtStrategy,
        { provide: ConfigService, useValue: { getOrThrow: () => 'isolated-closeout' } },
        { provide: PrismaService, useValue: db },
        { provide: WxWorkService, useValue: {} }, { provide: OAuthStateService, useValue: {} },
        { provide: ExternalNodesService, useValue: new ExternalNodesService(db as any, {} as any, {} as any, {} as any, cipher) },
        { provide: AuditService, useValue: audit }, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    jwt = module.get(JwtService);
  });
  afterAll(async () => { await app?.close(); });
  const call = (path: string, token?: string, body?: unknown, method = body ? 'POST' : 'GET') => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  async function login(password = 'current-password') {
    const response = await call('/auth/login', undefined, { username: 'owner', password });
    expect(response.status).toBe(201);
    return (await response.json() as { accessToken: string }).accessToken;
  }

  it('redacts list/rename, reauthenticates credential reads, rejects other owners, rate limits and redacts audit', async () => {
    const token = await login();
    const list = await call('/external-nodes', token);
    expect(list.status).toBe(200);
    const body = await list.json() as any[];
    expect(body[0]).toMatchObject({ id: 'ext', name: 'private node' });
    for (const field of ['uuid', 'username', 'password', 'rawUri', 'xhttpExtra', 'shortId', 'credentialsEnc']) expect(body[0]).not.toHaveProperty(field);
    const renamed = await call('/external-nodes/ext/rename', token, { name: 'new name' }, 'PATCH');
    expect(renamed.status).toBe(200);
    expect(await renamed.text()).not.toContain('credentialsEnc');
    expect((await call('/external-nodes/ext/credentials', undefined, { currentPassword: 'current-password' })).status).toBe(401);
    expect((await call('/external-nodes/ext/credentials', token, { currentPassword: 'wrong' })).status).toBe(400);
    for (const id of ['foreign', 'admin']) {
      const denied = await call('/external-nodes/ext/credentials', jwt.sign({ sub: id, tokenVersion: 0 }), { currentPassword: 'current-password' });
      expect(denied.status).toBe(404);
      expect(await denied.text()).not.toContain('proxy-secret');
    }
    const response = await call('/external-nodes/ext/credentials', token, { currentPassword: 'current-password' });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ username: 'proxy-user', password: 'proxy-secret' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREDENTIAL_READ', actorId: 'owner', resourceId: 'ext', diff: { currentPassword: '[REDACTED]' } }));
    expect((await call('/external-nodes/ext/credentials', token, { currentPassword: 'current-password', tokenVersion: 5 })).status).toBe(400);
    expect((await call('/external-nodes/ext/credentials', token, { currentPassword: 'current-password' })).status).toBe(429);
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('proxy-secret');
  });

  it('revokes two old devices and legacy JWTs, keeps the replacement session, then invalidates it on password change', async () => {
    const deviceA = await login();
    const deviceB = await login();
    const legacy = jwt.sign({ sub: 'owner', role: 'OPERATOR' });
    for (const token of [deviceA, deviceB, legacy]) expect((await call('/external-nodes', token)).status).toBe(200);
    expect((await call('/auth/revoke-other-sessions', deviceA, { currentPassword: 'wrong' })).status).toBe(400);
    const revoke = await call('/auth/revoke-other-sessions', deviceA, { currentPassword: 'current-password' });
    expect(revoke.status).toBe(201);
    expect(revoke.headers.get('cache-control')).toBe('no-store');
    const replacement = (await revoke.json() as { accessToken: string }).accessToken;
    expect(jwt.verify(replacement).tokenVersion).toBe(1);
    for (const token of [deviceA, deviceB, legacy]) expect((await call('/external-nodes', token)).status).toBe(401);
    expect((await call('/external-nodes', replacement)).status).toBe(200);
    const changed = await call('/auth/change-password', replacement, { currentPassword: 'current-password', newPassword: 'new-password' }, 'PATCH');
    expect(changed.status).toBe(200);
    expect((await call('/external-nodes', replacement)).status).toBe(401);
    expect((await call('/auth/login', undefined, { username: 'owner', password: 'current-password' })).status).toBe(401);
    const fresh = await login('new-password');
    expect(jwt.verify(fresh).tokenVersion).toBe(2);
    expect((await call('/external-nodes', fresh)).status).toBe(200);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE', resource: 'account-password', diff: { currentPassword: '[REDACTED]', newPassword: '[REDACTED]' } }));
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('new-password');
  });
});
