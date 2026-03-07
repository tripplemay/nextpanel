import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { MetricsModule } from '../metrics/metrics.module';
import { IpCheckModule } from '../ip-check/ip-check.module';

@Module({
  imports: [MetricsModule, IpCheckModule],
  providers: [AgentService],
  controllers: [AgentController],
})
export class AgentModule {}
