import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IpInfoService } from './ip-info.service';
import { GfwCheckService } from './gfw-check.service';
import { RouteCheckService } from './route-check/route-check.service';
import { ReportIpCheckResultDto } from './dto/report-result.dto';

@Injectable()
export class IpCheckService {
  private readonly logger = new Logger(IpCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipInfo: IpInfoService,
    private readonly gfw: GfwCheckService,
    private readonly routeCheck: RouteCheckService,
  ) {}

  /** Called after server creation — fire-and-forget */
  triggerCheck(serverId: string): void {
    void this.runCheck(serverId);
  }

  /** Returns the latest check result for a server */
  async getLatest(serverId: string, userId: string) {
    const server = await this.prisma.server.findFirst({ where: { id: serverId, userId } });
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);

    return this.prisma.serverIpCheck.findUnique({ where: { serverId } });
  }

  /** Manual full re-check trigger */
  async triggerManual(serverId: string, userId: string): Promise<void> {
    const server = await this.prisma.server.findFirst({ where: { id: serverId, userId } });
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);

    // Reset status to PENDING so frontend shows loading
    await this.prisma.serverIpCheck.upsert({
      where: { serverId },
      create: { serverId, status: 'PENDING' },
      update: { status: 'PENDING', startedAt: null, finishedAt: null, error: null },
    });

    void this.runCheck(serverId);
  }

  /** Manual GFW-only re-check */
  async triggerGfw(serverId: string, userId: string): Promise<void> {
    const server = await this.prisma.server.findFirst({ where: { id: serverId, userId } });
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);

    void this.runGfwCheck(serverId, server.ip, server.sshPort);
  }

  /** Agent reports streaming check results */
  async reportResult(serverId: string, dto: ReportIpCheckResultDto): Promise<void> {
    // Verify the agent token belongs to this server
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, agentToken: dto.agentToken },
      select: { id: true, ip: true },
    });
    if (!server) throw new NotFoundException('Server not found or token mismatch');

    const check = await this.prisma.serverIpCheck.findUnique({ where: { serverId } });
    if (!check) return;

    if (!dto.success) {
      await this.prisma.serverIpCheck.update({
        where: { serverId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: dto.error ?? 'Agent reported failure',
        },
      });
      return;
    }

    // If agent reported routeData (outbound/回程), merge with inbound (去程) from panel
    let finalRouteData: Prisma.InputJsonValue | undefined;
    if (dto.routeData) {
      const inbound = await this.routeCheck.checkInbound(server.ip);
      finalRouteData = (inbound
        ? { ...dto.routeData, inbound }
        : dto.routeData) as Prisma.InputJsonValue;
    }

    await this.prisma.serverIpCheck.update({
      where: { serverId },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        netflix: dto.netflix,
        netflixRegion: dto.netflixRegion,
        disney: dto.disney,
        disneyRegion: dto.disneyRegion,
        youtube: dto.youtube,
        youtubeRegion: dto.youtubeRegion,
        hulu: dto.hulu,
        bilibili: dto.bilibili,
        openai: dto.openai,
        claude: dto.claude,
        gemini: dto.gemini,
        ...(finalRouteData ? { routeData: finalRouteData } : {}),
      },
    });

    // Auto-tag: regenerate based on check results
    const autoTags: string[] = [];
    if (dto.netflix === 'UNLOCKED') autoTags.push('Netflix');
    if (dto.claude === 'AVAILABLE') autoTags.push('AI');
    await this.prisma.server.update({ where: { id: serverId }, data: { autoTags } });
  }

  /** Returns pending streaming check task for a server (by agentToken) */
  async getPendingTask(agentToken: string): Promise<{ serverId: string } | null> {
    const server = await this.prisma.server.findUnique({ where: { agentToken } });
    if (!server) return null;

    const check = await this.prisma.serverIpCheck.findUnique({
      where: { serverId: server.id },
      select: { serverId: true, status: true },
    });

    if (check?.status === 'RUNNING') {
      return { serverId: server.id };
    }
    return null;
  }

  /** Scheduled: expire streaming checks that have been RUNNING for more than 10 minutes (Agent offline) */
  @Cron('*/5 * * * *')
  async expireStaleChecks(): Promise<void> {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const result = await this.prisma.serverIpCheck.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: { status: 'FAILED', error: 'Agent 未响应（超时）', finishedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.warn(`Expired ${result.count} stale IP check(s)`);
    }
  }

  /** Scheduled GFW check every 6 hours */
  @Cron('0 */6 * * *')
  async scheduledGfwCheck(): Promise<void> {
    if (!this.gfw.isConfigured) return;

    const servers = await this.prisma.server.findMany({
      select: { id: true, ip: true, sshPort: true },
    });

    this.logger.log(`Running scheduled GFW check for ${servers.length} servers`);

    for (const server of servers) {
      await this.runGfwCheck(server.id, server.ip, server.sshPort);
    }
  }

  private async runCheck(serverId: string): Promise<void> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: { ip: true, sshPort: true },
    });
    if (!server) return;

    // Upsert check record and mark as RUNNING
    await this.prisma.serverIpCheck.upsert({
      where: { serverId },
      create: { serverId, status: 'RUNNING', startedAt: new Date() },
      update: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, error: null },
    });

    // Step 1: Fetch IP basic info immediately (panel-side, fast)
    try {
      const info = await this.ipInfo.lookup(server.ip);
      if (info) {
        await this.prisma.serverIpCheck.update({
          where: { serverId },
          data: {
            ipType: info.ipType,
            asn: info.asn,
            org: info.org,
            country: info.country,
            city: info.city,
          },
        });
      }
    } catch (err) {
      this.logger.warn(`IP info lookup failed for server ${serverId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 2: GFW check (panel-side via Serverless)
    await this.runGfwCheck(serverId, server.ip, server.sshPort);

    // Step 3: Streaming check task is picked up by Agent on next heartbeat
    // Status stays RUNNING until Agent reports back via reportResult()
    // If Agent is not installed, status remains RUNNING indefinitely
    // Frontend shows partial results (IP info + GFW) immediately
  }

  private async runGfwCheck(serverId: string, ip: string, port: number): Promise<void> {
    const result = await this.gfw.check(ip, port);
    if (result === null) return;

    await this.prisma.serverIpCheck.upsert({
      where: { serverId },
      create: {
        serverId,
        status: 'PENDING',
        gfwBlocked: !result.reachable,
        gfwCheckedAt: new Date(),
      },
      update: {
        gfwBlocked: !result.reachable,
        gfwCheckedAt: new Date(),
      },
    });
  }
}
