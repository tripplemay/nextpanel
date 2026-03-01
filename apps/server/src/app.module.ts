import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { ServersModule } from './servers/servers.module';
import { NodesModule } from './nodes/nodes.module';
import { TemplatesModule } from './templates/templates.module';
import { ReleasesModule } from './releases/releases.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { AuditModule } from './audit/audit.module';
import { MetricsModule } from './metrics/metrics.module';
import { AgentModule } from './agent/agent.module';
import { PipelinesModule } from './pipelines/pipelines.module';
import { OperationLogModule } from './operation-log/operation-log.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ServersModule,
    NodesModule,
    TemplatesModule,
    ReleasesModule,
    SubscriptionsModule,
    AuditModule,
    MetricsModule,
    AgentModule,
    PipelinesModule,
    OperationLogModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
