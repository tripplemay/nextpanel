import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TemplatesService } from './templates.service';
import { AuditService } from '../audit/audit.service';
import { CreateTemplateDto } from './dto/create-template.dto';

@ApiTags('templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('templates')
export class TemplatesController {
  constructor(
    private templatesService: TemplatesService,
    private auditService: AuditService,
  ) {}

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  async create(@Body() dto: CreateTemplateDto, @CurrentUser() user: { id: string }) {
    const template = await this.templatesService.create(dto, user.id);
    await this.auditService.log({
      actorId: user.id,
      action: 'CREATE',
      resource: 'Template',
      resourceId: template.id,
      diff: { name: dto.name },
    });
    return template;
  }

  @Get()
  findAll() {
    return this.templatesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateTemplateDto>,
    @CurrentUser() user: { id: string },
  ) {
    const template = await this.templatesService.update(id, dto);
    await this.auditService.log({
      actorId: user.id,
      action: 'UPDATE',
      resource: 'Template',
      resourceId: id,
      diff: dto as Record<string, unknown>,
    });
    return template;
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    const result = await this.templatesService.remove(id);
    await this.auditService.log({
      actorId: user.id,
      action: 'DELETE',
      resource: 'Template',
      resourceId: id,
    });
    return result;
  }
}
