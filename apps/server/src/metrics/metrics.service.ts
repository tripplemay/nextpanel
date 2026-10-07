import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MAX_METRIC_POINTS, METRIC_RANGES, MetricRange } from './metrics-query.dto';

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

  async getServerMetrics(serverId: string, userId: string, limit = 60, range?: MetricRange, now = new Date()) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_METRIC_POINTS) {
      throw new BadRequestException(`limit must be an integer between 1 and ${MAX_METRIC_POINTS}`);
    }
    if (range !== undefined && !Object.hasOwn(METRIC_RANGES, range)) {
      throw new BadRequestException('Invalid metric range');
    }
    // Verify ownership before returning metrics
    const server = await this.prisma.server.findFirst({ where: { id: serverId, userId } });
    if (!server) return [];
    if (range) {
      const seconds = METRIC_RANGES[range];
      const since = new Date(now.getTime() - seconds * 1000);
      const bucketSeconds = Math.ceil(seconds / limit);
      // Prisma DateTime columns are UTC timestamp-without-timezone. Bind ISO text
      // explicitly as timestamp so a non-UTC database session cannot shift the window.
      const sinceUtc = since.toISOString();
      const nowUtc = now.toISOString();
      // Aggregate inside PostgreSQL; never load the entire history into Node.js.
      const rows = await this.prisma.$queryRaw<Array<{
        bucket: number; cpu: number; mem: number; disk: number; networkIn: number; networkOut: number;
      }>>`
        SELECT floor(extract(epoch FROM (m.timestamp - ${sinceUtc}::timestamp)) / ${bucketSeconds})::int AS bucket,
               avg(m.cpu)::float8 AS cpu, avg(m.mem)::float8 AS mem, avg(m.disk)::float8 AS disk,
               avg(m."networkIn")::float8 AS "networkIn", avg(m."networkOut")::float8 AS "networkOut"
        FROM "ServerMetric" m JOIN "Server" s ON s.id = m."serverId"
        WHERE m."serverId" = ${serverId} AND s."userId" = ${userId}
          AND m.timestamp >= ${sinceUtc}::timestamp AND m.timestamp < ${nowUtc}::timestamp
        GROUP BY bucket ORDER BY bucket DESC LIMIT ${limit}
      `;
      return rows.map(({ bucket, ...values }) => {
        const timestamp = new Date(since.getTime() + bucket * bucketSeconds * 1000);
        return { id: `aggregate:${timestamp.toISOString()}`, serverId, timestamp, ...values };
      });
    }
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
