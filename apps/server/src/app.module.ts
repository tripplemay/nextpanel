import { Module } from '@nestjs/common';
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
  ],
})
export class AppModule {}
