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

  /**
   * Delete ServerMetric rows older than the retention window.
   * Guards against non-positive `retentionDays` (falls back to 14) so a
   * misconfiguration can never wipe the entire time-series table.
   * Returns the number of rows deleted.
   */
  async pruneOldMetrics(retentionDays: number, now: Date = new Date()): Promise<number> {
    const days =
      Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : 14;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.serverMetric.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });
    return count;
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
