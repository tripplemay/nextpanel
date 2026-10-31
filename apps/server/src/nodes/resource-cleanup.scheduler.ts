import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { withPostgresAdvisoryLocks } from '../common/database/advisory-lock';
import { CleanupBlockedError, ResourceLifecycleService } from '../resources/resource-lifecycle.service';
import { NodeDeployService } from './node-deploy.service';

@Injectable()
export class ResourceCleanupScheduler {
  private readonly logger = new Logger(ResourceCleanupScheduler.name);
  private running = false;

  constructor(private prisma: PrismaService, private resources: ResourceLifecycleService, private deploy: NodeDeployService) {}

  @Cron('*/30 * * * * *')
  async tick() {
    if (this.running || process.env.RESOURCE_CLEANUP_ENABLED === 'false') return;
    this.running = true;
    try {
      const due = await this.prisma.resourceCleanup.findMany({
        where: { state: { in: ['PENDING', 'RUNNING'] }, nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' }, take: 10,
      });
      for (const candidate of due) {
        try {
          await withPostgresAdvisoryLocks([
            `nextpanel:cleanup:${candidate.id}`, `nextpanel:node:${candidate.nodeId}`,
            `nextpanel:server-core:${candidate.serverId}`, `nextpanel:server-ports:${candidate.serverId}`,
          ], async () => {
            const job = await this.prisma.resourceCleanup.findUnique({ where: { id: candidate.id } });
            if (!job || !['PENDING', 'RUNNING'].includes(job.state) || job.nextAttemptAt > new Date()) return;
            // The persisted lease survives process death; the advisory lock fences live workers.
            await this.prisma.resourceCleanup.update({ where: { id: job.id }, data: {
              state: 'RUNNING', attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 300000),
            } });
            try {
              if (await this.prisma.node.findUnique({ where: { id: job.nodeId }, select: { id: true } })) {
                throw new CleanupBlockedError('Node is desired again; possible database restore or concurrent operation');
              }
              await this.deploy.cleanupDetachedResource(job);
              await this.prisma.resourceCleanup.update({ where: { id: job.id }, data: {
                state: 'DONE', completedAt: new Date(), lastError: null,
              } });
            } catch (error) {
              const blocked = error instanceof CleanupBlockedError;
              const message = error instanceof Error ? error.message : 'Cleanup failed';
              await this.prisma.resourceCleanup.update({ where: { id: job.id }, data: {
                state: blocked ? 'BLOCKED' : 'PENDING', lastError: message.slice(0, 500),
                nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7))),
              } });
            }
          });
        } catch (error) { this.logger.warn(`Cleanup task ${candidate.id} deferred: ${error instanceof Error ? error.message : 'unknown error'}`); }
      }
      await this.resources.finishRetiredServers();
    } finally { this.running = false; }
  }
}
