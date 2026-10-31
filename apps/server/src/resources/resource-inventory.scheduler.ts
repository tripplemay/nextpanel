import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { ResourceLifecycleService } from './resource-lifecycle.service';

@Injectable()
export class ResourceInventoryScheduler {
  private running = false;
  private cursor: string | undefined;
  private readonly logger = new Logger(ResourceInventoryScheduler.name);
  constructor(private prisma: PrismaService, private resources: ResourceLifecycleService) {}

  // Bounded, read-only batches also inspect retired hosts whose cleanup is pending.
  @Cron('0 */5 * * * *')
  async tick() {
    if (this.running || process.env.RESOURCE_INVENTORY_ENABLED === 'false') return;
    this.running = true;
    try {
      const servers = await this.prisma.server.findMany({
        where: { sshAuthEnc: { not: '' }, ...(this.cursor ? { id: { gt: this.cursor } } : {}) },
        orderBy: { id: 'asc' }, take: 5, select: { id: true, userId: true },
      });
      for (const server of servers) {
        this.cursor = server.id;
        try { await this.resources.scan(server.id, server.userId); }
        catch { this.logger.warn(`Resource inventory unavailable for server ${server.id}; no cleanup authorized`); }
      }
      if (servers.length < 5) this.cursor = undefined;
    } finally { this.running = false; }
  }
}
