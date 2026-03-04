import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { XrayTestService } from './xray-test/xray-test.service';

@Injectable()
export class ConnectivityScheduler {
  private readonly logger = new Logger(ConnectivityScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly xrayTest: XrayTestService,
  ) {}

  /** Run serial connectivity test for all enabled+running nodes every hour */
  @Cron('0 0 * * * *')
  async testAllNodes(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous connectivity test still running, skipping this cycle');
      return;
    }
    this.running = true;
    try {
      const nodes = await this.prisma.node.findMany({
        where: { enabled: true, status: 'RUNNING' },
        select: { id: true },
      });
      this.logger.log(`Scheduled connectivity test: ${nodes.length} nodes`);

      for (const node of nodes) {
        try {
          await this.xrayTest.testNode(node.id);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Scheduled test failed for node ${node.id}: ${msg}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
