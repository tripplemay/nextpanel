import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { ServersModule } from './servers/servers.module';
import { NodesModule } from './nodes/nodes.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { AuditModule } from './audit/audit.module';
import { MetricsModule } from './metrics/metrics.module';
import { AgentModule } from './agent/agent.module';
import { OperationLogModule } from './operation-log/operation-log.module';
import { CloudflareModule } from './cloudflare/cloudflare.module';
import { RulesModule } from './rules/rules.module';
import { InviteCodesModule } from './invite-codes/invite-codes.module';
import { UsersModule } from './users/users.module';
import { ExternalNodesModule } from './external-nodes/external-nodes.module';
import { IpCheckModule } from './ip-check/ip-check.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    ServersModule,
    NodesModule,
    SubscriptionsModule,
    AuditModule,
    MetricsModule,
    AgentModule,
    OperationLogModule,
    CloudflareModule,
    RulesModule,
    InviteCodesModule,
    UsersModule,
    ExternalNodesModule,
    IpCheckModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
