import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  async getOverview() {
    const [totalServers, onlineServers, totalNodes, runningNodes] =
      await Promise.all([
        this.prisma.server.count(),
        this.prisma.server.count({ where: { status: 'ONLINE' } }),
        this.prisma.node.count(),
        this.prisma.node.count({ where: { status: 'RUNNING' } }),
      ]);

    return { totalServers, onlineServers, totalNodes, runningNodes };
  }

  async getServerMetrics(serverId: string, limit = 60) {
    const records = await this.prisma.serverMetric.findMany({
      where: { serverId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    // Convert BigInt to Number for JSON serialization
    return records.map((r) => ({
      ...r,
      networkIn: Number(r.networkIn),
      networkOut: Number(r.networkOut),
    }));
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

    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        status: 'ONLINE',
        cpuUsage: cpu,
        memUsage: mem,
        diskUsage: disk,
        lastSeenAt: new Date(),
      },
    });
  }
}
