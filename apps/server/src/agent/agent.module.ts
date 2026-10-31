import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { MetricsModule } from '../metrics/metrics.module';
import { IpCheckModule } from '../ip-check/ip-check.module';
import { ResourcesModule } from '../resources/resources.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [MetricsModule, IpCheckModule, ResourcesModule, UsageModule],
  providers: [AgentService],
  controllers: [AgentController],
})
export class AgentModule {}
