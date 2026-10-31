import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { UsageService } from './usage.service';
import { UsageProvisioner } from './usage-provisioner.service';
import { UsagePrepareDto } from './usage.dto';

@Controller('usage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OPERATOR')
export class UsageController {
  constructor(private usage: UsageService, private provisioner: UsageProvisioner) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  overview(@CurrentUser() user: { id: string }, @Query('subscriptionId') id?: string) { return this.usage.overview(user.id, id); }
  @Get(':id/history')
  @Header('Cache-Control', 'private, no-store')
  history(@Param('id') id: string, @CurrentUser() user: { id: string }) { return this.usage.history(id, user.id); }
  @Post('nodes/:id/prepare')
  @Audit('UPDATE', 'usage-node')
  prepare(@Param('id') id: string, @CurrentUser() user: { id: string }, @Body() dto: UsagePrepareDto) {
    return this.provisioner.sync(id, user.id, dto.allowRestart);
  }
}
