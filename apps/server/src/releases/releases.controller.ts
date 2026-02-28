import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { ReleasesService } from './releases.service';
import { CreateReleaseDto } from './dto/create-release.dto';

@ApiTags('releases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('releases')
export class ReleasesController {
  constructor(
    private releasesService: ReleasesService,
    private auditService: AuditService,
  ) {}

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Create and trigger a deployment release' })
  async create(
    @Body() dto: CreateReleaseDto,
    @CurrentUser() user: { id: string },
  ) {
    const release = await this.releasesService.create(dto, user.id);
    await this.auditService.log({
      actorId: user.id,
      action: 'DEPLOY',
      resource: 'release',
      resourceId: release.id,
    });
    return release;
  }

  @Get()
  @ApiOperation({ summary: 'List all releases' })
  findAll() {
    return this.releasesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get release details with step logs' })
  findOne(@Param('id') id: string) {
    return this.releasesService.findOne(id);
  }

  @Post(':id/rollback')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Rollback a release' })
  async rollback(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    const result = await this.releasesService.rollback(id);
    await this.auditService.log({
      actorId: user.id,
      action: 'ROLLBACK',
      resource: 'release',
      resourceId: id,
    });
    return result;
  }
}
