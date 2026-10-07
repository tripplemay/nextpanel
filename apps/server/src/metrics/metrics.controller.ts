import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MetricsService } from './metrics.service';
import { MetricsQueryDto } from './metrics-query.dto';

@ApiTags('metrics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('metrics')
export class MetricsController {
  constructor(private metricsService: MetricsService) {}

  @Get('overview')
  getOverview(@CurrentUser() user: { id: string }) {
    return this.metricsService.getOverview(user.id);
  }

  @Get('servers/:id')
  getServerMetrics(
    @Param('id') id: string,
    @Query() query: MetricsQueryDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.metricsService.getServerMetrics(id, user.id, query.limit, query.range);
  }
}
