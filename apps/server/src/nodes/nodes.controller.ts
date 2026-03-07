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
  HttpCode,
  HttpStatus,
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
import { XrayTestService } from './xray-test/xray-test.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { CreateNodeFromPresetDto } from './dto/create-node-from-preset.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { PROTOCOL_PRESETS, SUPPORTED_PROTOCOLS } from './protocols/presets';

@ApiTags('nodes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('nodes')
export class NodesController {
  constructor(
    private nodesService: NodesService,
    private nodeDeploy: NodeDeployService,
    private xrayTest: XrayTestService,
    private auditService: AuditService,
  ) {}

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  @Audit('CREATE', 'node')
  @ApiOperation({ summary: 'Create a new node (manual — all fields required)' })
  create(
    @Body() dto: CreateNodeDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.nodesService.create(dto, user.id);
  }

  @Get('presets')
  @ApiOperation({ summary: 'List all available protocol presets' })
  listPresets() {
    return SUPPORTED_PROTOCOLS.map((key) => ({
      value: key,
      ...PROTOCOL_PRESETS[key],
    }));
  }

  @Post('preset')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('CREATE', 'node')
  @ApiOperation({ summary: 'Create a node from a protocol preset — auto-generates all config and credentials' })
  createFromPreset(
    @Body() dto: CreateNodeFromPresetDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.nodesService.createFromPreset(user.id, dto);
  }

  @Get()
  @ApiQuery({ name: 'serverId', required: false })
  @ApiOperation({ summary: 'List nodes, optionally filter by serverId' })
  findAll(
    @CurrentUser() user: { id: string },
    @Query('serverId') serverId?: string,
  ) {
    return this.nodesService.findAll(user.id, serverId);
  }

  @Sse('test-all')
  @Roles('ADMIN', 'OPERATOR')
  @ApiQuery({ name: 'ids', required: false, description: 'Comma-separated node IDs. Omit to test all nodes.' })
  @ApiOperation({ summary: 'Batch-test nodes via Xray and stream results as SSE' })
  testAllStream(
    @CurrentUser() user: { id: string },
    @Query('ids') ids?: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const run = async () => {
        let nodeIds: string[];
        if (ids) {
          // Filter provided IDs to only those owned by the current user
          const ownedNodes = await this.nodesService.findAll(user.id);
          const ownedIds = new Set(ownedNodes.map((n) => n.id));
          nodeIds = ids.split(',').filter((id) => ownedIds.has(id));
        } else {
          const nodes = await this.nodesService.findAll(user.id);
          nodeIds = nodes.map((n) => n.id);
        }

        if (nodeIds.length === 0) {
          subscriber.next({ data: JSON.stringify({ type: 'done', total: 0 }) } as MessageEvent);
          subscriber.complete();
          return;
        }

        let completed = 0;
        const total = nodeIds.length;

        await Promise.allSettled(
          nodeIds.map(async (nodeId) => {
            let result: { reachable: boolean; latency: number; message: string; testedAt: string };
            try {
              result = await this.xrayTest.testNode(nodeId);
            } catch (err) {
              result = {
                reachable: false,
                latency: -1,
                message: err instanceof Error ? err.message : String(err),
                testedAt: new Date().toISOString(),
              };
            }
            subscriber.next({ data: JSON.stringify({ type: 'result', nodeId, ...result }) } as MessageEvent);
            if (++completed === total) {
              subscriber.next({ data: JSON.stringify({ type: 'done', total }) } as MessageEvent);
              subscriber.complete();
            }
          }),
        );
      };

      run().catch((err) => subscriber.error(err));
    });
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.nodesService.findOne(id, user.id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'node')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNodeDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.nodesService.update(id, dto, user.id);
  }

  @Patch(':id/rename')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'node')
  @ApiOperation({ summary: 'Rename a node (no redeploy)' })
  rename(
    @Param('id') id: string,
    @Body('name') name: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.nodesService.rename(id, name, user.id);
  }

  @Patch(':id/toggle')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'node')
  @ApiOperation({ summary: 'Toggle node enabled state (start/stop service)' })
  toggle(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.nodesService.toggle(id, user.id);
  }

  @Get(':id/deploy-log')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Get the latest deployment log for a node' })
  async getDeployLog(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.nodesService.findOne(id, user.id);
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
  getCredentials(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.nodesService.getCredentials(id, user.id);
  }

  @Get(':id/share')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Get single-node share URI (vmess://, vless://, etc.)' })
  async getShareLink(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    const uri = await this.nodesService.getShareLink(id, user.id);
    return { uri };
  }

  @Post(':id/test')
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Test node proxy connectivity via Xray (end-to-end)' })
  async testNode(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.nodesService.findOne(id, user.id);
    return this.xrayTest.testNode(id);
  }

  @Post(':id/deploy')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('DEPLOY', 'node')
  @ApiOperation({ summary: 'Deploy node config to server via SSH' })
  async deploy(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Req() req: { correlationId?: string },
  ) {
    await this.nodesService.findOne(id, user.id);
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
  @Roles('ADMIN', 'OPERATOR')
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
  @Roles('ADMIN', 'OPERATOR')
  @Audit('DELETE', 'node')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.nodesService.remove(id, user.id);
  }
}
