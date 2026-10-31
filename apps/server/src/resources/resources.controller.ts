import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { ResourceLifecycleService } from './resource-lifecycle.service';

@Controller('resources')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResourcesController {
  constructor(private resources: ResourceLifecycleService) {}

  @Get()
  list(@CurrentUser() user: { id: string }) { return this.resources.list(user.id); }

  // Inventory only. A scan never authorizes deletion of unknown services.
  @Post('servers/:id/scan')
  scan(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.resources.scan(id, user.id);
  }

  @Post('cleanup/:id/retry')
  @Audit('UPDATE', 'resource-cleanup')
  retry(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.resources.retry(id, user.id);
  }
}
