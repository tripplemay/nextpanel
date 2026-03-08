import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { IpCheckService } from '../ip-check/ip-check.service';

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

interface LatestVersionCache {
  version: string;
  releaseNotes: string;
  fetchedAt: number;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  /** Stores previous cumulative network bytes per server for rate calculation */
  private readonly prevNetwork = new Map<string, { in: number; out: number }>();
  /** Cache latest GitHub release for 1 hour */
  private latestVersionCache: LatestVersionCache | null = null;

  constructor(
    private prisma: PrismaService,
    private metricsService: MetricsService,
    private ipCheck: IpCheckService,
    private config: ConfigService,
  ) {}

  async getLatestVersion(): Promise<{ version: string; releaseNotes: string }> {
    const ONE_HOUR = 60 * 60 * 1000;
    if (this.latestVersionCache && Date.now() - this.latestVersionCache.fetchedAt < ONE_HOUR) {
      return this.latestVersionCache;
    }

    const repo = this.config.get<string>('GITHUB_REPO') ?? 'tripplemay/nextpanel-releases';
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nextpanel-server' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const data = await res.json() as { tag_name: string; body?: string };
      const version = data.tag_name.replace(/^v/, '');
      const releaseNotes = data.body ?? '';
      this.latestVersionCache = { version, releaseNotes, fetchedAt: Date.now() };
      return { version, releaseNotes };
    } catch (err) {
      this.logger.warn(`Failed to fetch latest agent version: ${err}`);
      return this.latestVersionCache ?? { version: '', releaseNotes: '' };
    }
  }

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

    const updateData: Record<string, unknown> = {
      agentVersion: payload.agentVersion,
      cpuUsage: payload.cpu,
      memUsage: payload.mem,
      diskUsage: payload.disk,
      networkIn: netInRate,
      networkOut: netOutRate,
      status: 'ONLINE',
      lastSeenAt: new Date(),
    };

    // Consume pendingAgentUpdate flag — clear it so we only send the command once
    if (server.pendingAgentUpdate) {
      updateData.pendingAgentUpdate = false;
    }

    await this.prisma.server.update({ where: { id: server.id }, data: updateData });

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

    // Return pending IP check task if any
    const ipCheckTask = await this.ipCheck.getPendingTask(payload.agentToken);

    // If pendingAgentUpdate was set, deliver update command
    let updateCommand: { version: string; downloadUrl: string } | undefined;
    if (server.pendingAgentUpdate) {
      const { version } = await this.getLatestVersion();
      if (version) {
        const repo = this.config.get<string>('GITHUB_REPO') ?? 'tripplemay/nextpanel-releases';
        updateCommand = {
          version,
          downloadUrl: `https://github.com/${repo}/releases/download/v${version}/agent-linux-amd64`,
        };
      }
    }

    return {
      ok: true,
      xrayNodes: xrayNodes.map((n) => ({ nodeId: n.id, statsPort: n.statsPort })),
      ...(ipCheckTask ? { ipCheckTask: { serverId: ipCheckTask.serverId } } : {}),
      ...(updateCommand ? { updateCommand } : {}),
    };
  }
}
