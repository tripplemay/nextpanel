import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './auth/jwt.strategy';
import { AuthService } from './auth/auth.service';
import { ServersController } from './servers/servers.controller';
import { ServersService } from './servers/servers.service';
import { AutoSetupService } from './servers/auto-setup.service';
import { ServerOwnerGuard } from './servers/server-owner.guard';
import { OperationLogController } from './operation-log/operation-log.controller';
import { OperationLogService } from './operation-log/operation-log.service';
import { AgentController } from './agent/agent.controller';
import { AgentService } from './agent/agent.service';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { AuditService } from './audit/audit.service';
import { connectSsh } from './nodes/ssh/ssh.util';

jest.mock('./nodes/ssh/ssh.util', () => ({ connectSsh: jest.fn() }));

describe('real HTTP routing, JWT, roles and ownership (isolated persistence)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;
  const db = {
    server: {
      findFirst: jest.fn(async ({ where }) => where.id === 'srv-1' && where.userId === 'owner'
        ? { id: 'srv-1', userId: 'owner', sshAuthEnc: 'encrypted', agentToken: 'SECRET' } : null),
      findUnique: jest.fn(async () => ({ agentToken: 'SECRET' })),
    },
    operationLog: {
      findFirst: jest.fn(async ({ where }) => !where.ownerId || where.ownerId === 'owner' ? { id: 'log-1', log: 'private-log', actorId: null } : null),
      findMany: jest.fn(async ({ where }) => !where.ownerId || where.ownerId === 'owner' ? [{ id: 'log-1' }] : []),
    },
  };
  const servers = new ServersService(db as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const install = jest.spyOn(servers as any, 'installAgent').mockResolvedValue(true);
  const heartbeat = jest.fn(async () => ({ ok: true }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: 'isolated-test-key' })],
      controllers: [ServersController, OperationLogController, AgentController],
      providers: [
        JwtStrategy, ServerOwnerGuard,
        { provide: ConfigService, useValue: { getOrThrow: () => 'isolated-test-key' } },
        { provide: AuthService, useValue: {
          isTokenRevoked: async () => false,
          validateById: async (id: string) => ({ id, role: id === 'admin' ? 'ADMIN' : 'VIEWER', tokenVersion: 0 }),
        } },
        { provide: ServersService, useValue: servers },
        { provide: AutoSetupService, useValue: new AutoSetupService(db as any, {} as any) },
        { provide: OperationLogService, useValue: new OperationLogService(db as any) },
        { provide: AgentService, useValue: { handleHeartbeat: heartbeat } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    jwt = module.get(JwtService);
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => jest.clearAllMocks());
  const headers = (id: string) => ({ Authorization: `Bearer ${jwt.sign({ sub: id, jti: id })}` });

  it.each(['install-agent', 'auto-setup'])('rejects unauthenticated and cross-tenant %s before SSE headers/SSH', async (path) => {
    expect((await fetch(`${base}/api/servers/srv-1/${path}`)).status).toBe(401);
    for (const id of ['other', 'admin']) {
      const response = await fetch(`${base}/api/servers/srv-1/${path}`, { headers: headers(id) });
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).not.toContain('text/event-stream');
      expect(await response.text()).not.toContain('SECRET');
    }
    expect(install).not.toHaveBeenCalled();
    expect(connectSsh).not.toHaveBeenCalled();
    expect(db.server.findUnique).not.toHaveBeenCalled();
  });
  it('preserves the authorized SSE installation path', async () => {
    const response = await fetch(`${base}/api/servers/srv-1/install-agent`, { headers: headers('owner') });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('"success":true');
    expect(install).toHaveBeenCalledTimes(1);
  });
  it.each(['log-1', 'by-correlation/corr-1', 'by-resource/node/deleted-node'])('isolates private log route %s even after resource deletion', async (path) => {
    expect((await fetch(`${base}/api/operation-logs/${path}`)).status).toBe(401);
    const denied = await fetch(`${base}/api/operation-logs/${path}`, { headers: headers('other') });
    expect(await denied.text()).not.toContain('log-1');
    for (const id of ['owner', 'admin']) {
      const allowed = await fetch(`${base}/api/operation-logs/${path}`, { headers: headers(id) });
      expect(await allowed.text()).toContain('log-1');
    }
  });
  it('validates nested heartbeat data before service invocation', async () => {
    const body = { agentToken: 'fixture', agentVersion: '1.7.0', architecture: 'arm64', cpu: 1, mem: 2, disk: 3, networkIn: 0, networkOut: 0 };
    for (const invalid of [{ cpu: 101 }, { architecture: 'mips' }, { nodeStatuses: [{ nodeId: 'x', status: 'DELETING' }] }, { nodeTraffic: [{ nodeId: 'x', upBytes: -1, downBytes: 0 }] }]) {
      const response = await fetch(`${base}/api/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...invalid }) });
      expect(response.status).toBe(400);
    }
    expect(heartbeat).not.toHaveBeenCalled();
    const response = await fetch(`${base}/api/agent/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBeLessThan(300);
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });
});
