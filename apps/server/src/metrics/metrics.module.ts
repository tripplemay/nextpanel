import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsRetentionScheduler } from './metrics-retention.scheduler';

@Module({
  providers: [MetricsService, MetricsRetentionScheduler],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}
