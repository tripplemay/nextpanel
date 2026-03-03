import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ServersService } from './servers.service';
import { AutoSetupService } from './auto-setup.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';

@ApiTags('servers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('servers')
export class ServersController {
  constructor(
    private serversService: ServersService,
    private autoSetupService: AutoSetupService,
  ) {}

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  @Audit('CREATE', 'server')
  @ApiOperation({ summary: 'Add a new server asset' })
  create(@Body() dto: CreateServerDto) {
    return this.serversService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all servers' })
  findAll() {
    return this.serversService.findAll();
  }

  @Get('check-ip')
  @ApiOperation({ summary: 'Check if an IP already exists' })
  checkIp(@Query('ip') ip: string) {
    return this.serversService.checkIp(ip);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a server by ID' })
  findOne(@Param('id') id: string) {
    return this.serversService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'server')
  @ApiOperation({ summary: 'Update server info' })
  update(@Param('id') id: string, @Body() dto: UpdateServerDto) {
    return this.serversService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit('DELETE', 'server')
  @ApiOperation({ summary: 'Delete a server' })
  remove(@Param('id') id: string) {
    return this.serversService.remove(id);
  }

  @Post(':id/test-ssh')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('SSH_TEST', 'server')
  @ApiOperation({ summary: 'Test SSH connectivity to a server' })
  testSsh(@Param('id') id: string) {
    return this.serversService.testSsh(id);
  }

  @Sse(':id/install-agent')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Install agent on server via SSH (SSE stream)' })
  installAgent(@Param('id') id: string): Observable<MessageEvent> {
    return this.serversService.installAgentStream(id);
  }

  @Sse(':id/auto-setup')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Auto-setup proxy nodes from templates (SSE stream)' })
  runAutoSetup(
    @Param('id') id: string,
    @Query('templateIds') templateIds: string,
    @CurrentUser() user: { id: string },
  ): Observable<MessageEvent> {
    const ids = templateIds ? templateIds.split(',').filter(Boolean) : [];
    return this.autoSetupService.setupStream(id, ids, user?.id);
  }
}
