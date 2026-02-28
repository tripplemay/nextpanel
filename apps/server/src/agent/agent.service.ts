import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MetricsService } from '../metrics/metrics.service';

export interface HeartbeatPayload {
  agentToken: string;
  agentVersion: string;
  cpu: number;
  mem: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  nodeStatuses?: { nodeId: string; status: 'RUNNING' | 'STOPPED' | 'ERROR' }[];
}

@Injectable()
export class AgentService {
  constructor(
    private prisma: PrismaService,
    private metricsService: MetricsService,
  ) {}

  async handleHeartbeat(payload: HeartbeatPayload) {
    const server = await this.prisma.server.findUnique({
      where: { agentToken: payload.agentToken },
    });

    if (!server) {
      throw new UnauthorizedException('Unknown agent token');
    }

    await this.prisma.server.update({
      where: { id: server.id },
      data: { agentVersion: payload.agentVersion },
    });

    await this.metricsService.record(
      server.id,
      payload.cpu,
      payload.mem,
      payload.disk,
      payload.networkIn,
      payload.networkOut,
    );

    if (payload.nodeStatuses) {
      for (const { nodeId, status } of payload.nodeStatuses) {
        await this.prisma.node.updateMany({
          where: { id: nodeId, serverId: server.id },
          data: { status },
        });
      }
    }

    return { ok: true };
  }
}
