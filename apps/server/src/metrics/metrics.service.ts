import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async getOverview(userId: string) {
    const [totalServers, onlineServers, totalNodes, runningNodes] =
      await Promise.all([
        this.prisma.server.count({ where: { userId } }),
        this.prisma.server.count({ where: { userId, status: 'ONLINE' } }),
        this.prisma.node.count({ where: { userId } }),
        this.prisma.node.count({ where: { userId, status: 'RUNNING' } }),
      ]);

    return { totalServers, onlineServers, totalNodes, runningNodes };
  }

  async getServerMetrics(serverId: string, userId: string, limit = 60) {
    // Verify ownership before returning metrics
    const server = await this.prisma.server.findFirst({ where: { id: serverId, userId } });
    if (!server) return [];
    return this.prisma.serverMetric.findMany({
      where: { serverId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /** Called by Agent heartbeat to record metrics */
  async record(
    serverId: string,
    cpu: number,
    mem: number,
    disk: number,
    networkIn: number,
    networkOut: number,
  ) {
    await this.prisma.serverMetric.create({
      data: { serverId, cpu, mem, disk, networkIn, networkOut },
    });
  }
}
