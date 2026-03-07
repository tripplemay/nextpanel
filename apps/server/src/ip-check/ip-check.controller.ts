import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IpCheckService } from './ip-check.service';
import { ReportIpCheckResultDto } from './dto/report-result.dto';

@ApiTags('ip-check')
@Controller('ip-check')
export class IpCheckController {
  constructor(private readonly service: IpCheckService) {}

  @Get(':serverId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  getLatest(
    @Param('serverId') serverId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.getLatest(serverId, user.id);
  }

  @Post(':serverId/trigger')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async triggerManual(
    @Param('serverId') serverId: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.service.triggerManual(serverId, user.id);
    return { ok: true };
  }

  @Post(':serverId/gfw')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async triggerGfw(
    @Param('serverId') serverId: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.service.triggerGfw(serverId, user.id);
    return { ok: true };
  }

  /** Called by Agent to report streaming check results — no JWT, uses agentToken */
  @Post(':serverId/result')
  async reportResult(
    @Param('serverId') serverId: string,
    @Body() dto: ReportIpCheckResultDto,
  ) {
    await this.service.reportResult(serverId, dto);
    return { ok: true };
  }
}
