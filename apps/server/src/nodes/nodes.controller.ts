import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Sse,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiTags, ApiBearerAuth, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { NodesService } from './nodes.service';
import { NodeDeployService } from './node-deploy.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';

@ApiTags('nodes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('nodes')
export class NodesController {
  constructor(
    private nodesService: NodesService,
    private nodeDeploy: NodeDeployService,
    private auditService: AuditService,
  ) {}

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Create a new node' })
  async create(@Body() dto: CreateNodeDto, @CurrentUser() user: { id: string }) {
    const node = await this.nodesService.create(dto);
    await this.auditService.log({
      actorId: user.id,
      action: 'CREATE',
      resource: 'node',
      resourceId: node.id,
    });
    return node;
  }

  @Get()
  @ApiQuery({ name: 'serverId', required: false })
  @ApiOperation({ summary: 'List nodes, optionally filter by serverId' })
  findAll(@Query('serverId') serverId?: string) {
    return this.nodesService.findAll(serverId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.nodesService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateNodeDto,
    @CurrentUser() user: { id: string },
  ) {
    const node = await this.nodesService.update(id, dto);
    await this.auditService.log({
      actorId: user.id,
      action: 'UPDATE',
      resource: 'node',
      resourceId: node.id,
      diff: dto as Record<string, unknown>,
    });
    return node;
  }

  @Post(':id/test')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Test node TCP connectivity' })
  testConnectivity(@Param('id') id: string) {
    return this.nodesService.testConnectivity(id);
  }

  @Post(':id/deploy')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Deploy node config to server via SSH' })
  deploy(@Param('id') id: string) {
    return this.nodeDeploy.deploy(id);
  }

  @Sse(':id/deploy-stream')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Stream deploy logs via SSE' })
  deployStream(@Param('id') id: string): Observable<MessageEvent> {
    return this.nodeDeploy.deployStream(id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    await this.auditService.log({
      actorId: user.id,
      action: 'DELETE',
      resource: 'node',
      resourceId: id,
    });
    return this.nodesService.remove(id);
  }
}
