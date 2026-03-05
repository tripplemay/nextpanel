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
  nodeTraffic?: { nodeId: string; upBytes: number; downBytes: number }[];
}

@Injectable()
export class AgentService {
  /** Stores previous cumulative network bytes per server for rate calculation */
  private readonly prevNetwork = new Map<string, { in: number; out: number }>();

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

    // Agent sends cumulative bytes; calculate bytes/sec rate from delta
    const INTERVAL = 10; // heartbeat interval in seconds
    const prev = this.prevNetwork.get(server.id);
    const netInRate  = prev ? Math.max(0, (payload.networkIn  - prev.in)  / INTERVAL) : 0;
    const netOutRate = prev ? Math.max(0, (payload.networkOut - prev.out) / INTERVAL) : 0;
    this.prevNetwork.set(server.id, { in: payload.networkIn, out: payload.networkOut });

    await this.prisma.server.update({
      where: { id: server.id },
      data: {
        agentVersion: payload.agentVersion,
        cpuUsage: payload.cpu,
        memUsage: payload.mem,
        diskUsage: payload.disk,
        networkIn: netInRate,
        networkOut: netOutRate,
        status: 'ONLINE',
        lastSeenAt: new Date(),
      },
    });

    await this.metricsService.record(
      server.id,
      payload.cpu,
      payload.mem,
      payload.disk,
      netInRate,
      netOutRate,
    );

    if (payload.nodeStatuses) {
      for (const { nodeId, status } of payload.nodeStatuses) {
        await this.prisma.node.updateMany({
          where: { id: nodeId, serverId: server.id },
          data: { status },
        });
      }
    }

    if (payload.nodeTraffic) {
      for (const { nodeId, upBytes, downBytes } of payload.nodeTraffic) {
        await this.prisma.node.updateMany({
          where: { id: nodeId, serverId: server.id },
          data: { trafficUpBytes: upBytes, trafficDownBytes: downBytes },
        });
      }
    }

    // Return xray nodes with their stats ports so the agent can query traffic
    const xrayNodes = await this.prisma.node.findMany({
      where: { serverId: server.id, statsPort: { not: null }, status: 'RUNNING' },
      select: { id: true, statsPort: true },
    });

    return {
      ok: true,
      xrayNodes: xrayNodes.map((n) => ({ nodeId: n.id, statsPort: n.statsPort })),
    };
  }
}
