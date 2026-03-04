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
  create(@Body() dto: CreateNodeDto) {
    return this.nodesService.create(dto);
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
  findAll(@Query('serverId') serverId?: string) {
    return this.nodesService.findAll(serverId);
  }

  @Sse('test-all')
  @Roles('ADMIN', 'OPERATOR')
  @ApiQuery({ name: 'ids', required: false, description: 'Comma-separated node IDs. Omit to test all nodes.' })
  @ApiOperation({ summary: 'Batch-test nodes via Xray and stream results as SSE' })
  testAllStream(@Query('ids') ids?: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const run = async () => {
        let nodeIds: string[];
        if (ids) {
          nodeIds = ids.split(',').filter(Boolean);
        } else {
          const nodes = await this.nodesService.findAll();
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
  findOne(@Param('id') id: string) {
    return this.nodesService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'node')
  update(@Param('id') id: string, @Body() dto: UpdateNodeDto) {
    return this.nodesService.update(id, dto);
  }

  @Patch(':id/rename')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'node')
  @ApiOperation({ summary: 'Rename a node (no redeploy)' })
  rename(@Param('id') id: string, @Body('name') name: string) {
    return this.nodesService.rename(id, name);
  }

  @Post(':id/regenerate-credentials')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'node')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate credentials and redeploy' })
  regenerateCredentials(@Param('id') id: string) {
    return this.nodesService.regenerateCredentials(id);
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
  @ApiOperation({ summary: 'Test node proxy connectivity via Xray (end-to-end)' })
  testNode(@Param('id') id: string) {
    return this.xrayTest.testNode(id);
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
