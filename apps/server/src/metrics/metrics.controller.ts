import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('metrics')
export class MetricsController {
  constructor(private metricsService: MetricsService) {}

  @Get('overview')
  getOverview() {
    return this.metricsService.getOverview();
  }

  @Get('servers/:id')
  getServerMetrics(
    @Param('id') id: string,
    @Query('limit') limit = 60,
  ) {
    return this.metricsService.getServerMetrics(id, +limit);
  }
}
