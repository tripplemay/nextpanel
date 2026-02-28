import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentService, HeartbeatPayload } from './agent.service';

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(private agentService: AgentService) {}

  /** Called by each node's agent to report health and metrics */
  @Post('heartbeat')
  @ApiOperation({ summary: 'Agent heartbeat — no JWT required, uses agentToken' })
  heartbeat(@Body() payload: HeartbeatPayload) {
    return this.agentService.handleHeartbeat(payload);
  }
}
