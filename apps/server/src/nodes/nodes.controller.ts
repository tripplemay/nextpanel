import { randomUUID } from 'crypto';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
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
import { Audit } from '../common/decorators/audit.decorator';
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
  @Audit('CREATE', 'node')
  @ApiOperation({ summary: 'Create a new node' })
  create(@Body() dto: CreateNodeDto) {
    return this.nodesService.create(dto);
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
  @Audit('UPDATE', 'node')
  update(@Param('id') id: string, @Body() dto: UpdateNodeDto) {
    return this.nodesService.update(id, dto);
  }

  @Get(':id/deploy-log')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Get the latest deployment log for a node' })
  async getDeployLog(@Param('id') id: string) {
    const snapshot = await this.nodesService.getLatestSnapshot(id);
    return {
      deployLog: snapshot?.deployLog ?? null,
      version: snapshot?.version ?? null,
      createdAt: snapshot?.createdAt ?? null,
    };
  }

  @Get(':id/credentials')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Get decrypted credentials for a node (edit use only)' })
  getCredentials(@Param('id') id: string) {
    return this.nodesService.getCredentials(id);
  }

  @Get(':id/share')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Get single-node share URI (vmess://, vless://, etc.)' })
  async getShareLink(@Param('id') id: string) {
    const uri = await this.nodesService.getShareLink(id);
    return { uri };
  }

  @Post(':id/test')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Test node TCP connectivity' })
  testConnectivity(@Param('id') id: string) {
    return this.nodesService.testConnectivity(id);
  }

  @Post(':id/deploy')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('DEPLOY', 'node')
  @ApiOperation({ summary: 'Deploy node config to server via SSH' })
  deploy(@Param('id') id: string, @Req() req: { correlationId?: string }) {
    return this.nodeDeploy.deploy(id, undefined, undefined, req.correlationId);
  }

  @Sse(':id/deploy-stream')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Stream deploy logs via SSE' })
  deployStream(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Observable<MessageEvent> {
    // SSE endpoints cannot use AuditInterceptor — write audit log manually
    const correlationId = randomUUID();
    void this.auditService.log({
      actorId: user.id,
      action: 'DEPLOY',
      resource: 'node',
      resourceId: id,
      correlationId,
    });
    return this.nodeDeploy.deployStream(id, user.id, correlationId);
  }

  @Sse(':id/delete-stream')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Stream undeploy logs and delete node via SSE' })
  deleteStream(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ): Observable<MessageEvent> {
    // SSE endpoints cannot use AuditInterceptor — write audit log manually
    const correlationId = randomUUID();
    void this.auditService.log({
      actorId: user.id,
      action: 'DELETE',
      resource: 'node',
      resourceId: id,
      correlationId,
    });
    return this.nodeDeploy.undeployStream(id, user.id, correlationId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit('DELETE', 'node')
  remove(@Param('id') id: string) {
    return this.nodesService.remove(id);
  }
}
