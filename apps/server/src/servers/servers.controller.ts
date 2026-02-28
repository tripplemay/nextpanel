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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';

@ApiTags('servers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('servers')
export class ServersController {
  constructor(
    private serversService: ServersService,
    private auditService: AuditService,
  ) {}

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Add a new server asset' })
  async create(@Body() dto: CreateServerDto, @CurrentUser() user: { id: string }) {
    const server = await this.serversService.create(dto);
    await this.auditService.log({
      actorId: user.id,
      action: 'CREATE',
      resource: 'server',
      resourceId: server.id,
    });
    return server;
  }

  @Get()
  @ApiOperation({ summary: 'List all servers' })
  findAll() {
    return this.serversService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a server by ID' })
  findOne(@Param('id') id: string) {
    return this.serversService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Update server info' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateServerDto,
    @CurrentUser() user: { id: string },
  ) {
    const server = await this.serversService.update(id, dto);
    await this.auditService.log({
      actorId: user.id,
      action: 'UPDATE',
      resource: 'server',
      resourceId: server.id,
      diff: dto as Record<string, unknown>,
    });
    return server;
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a server' })
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    await this.auditService.log({
      actorId: user.id,
      action: 'DELETE',
      resource: 'server',
      resourceId: id,
    });
    return this.serversService.remove(id);
  }

  @Post(':id/test-ssh')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Test SSH connectivity to a server' })
  async testSsh(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    const result = await this.serversService.testSsh(id);
    await this.auditService.log({
      actorId: user.id,
      action: 'SSH_TEST',
      resource: 'server',
      resourceId: id,
    });
    return result;
  }
}
