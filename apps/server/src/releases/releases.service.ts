import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateReleaseDto } from './dto/create-release.dto';

@Injectable()
export class ReleasesService {
  private readonly logger = new Logger(ReleasesService.name);

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateReleaseDto, createdById: string) {
    const release = await this.prisma.release.create({
      data: {
        templateId: dto.templateId,
        targets: dto.targets,
        strategy: dto.strategy,
        variables: dto.variables ?? {},
        createdById,
        steps: {
          create: dto.targets.map((serverId) => ({
            serverId,
            status: 'PENDING',
          })),
        },
      },
      include: { steps: true },
    });

    // Trigger async execution — log errors instead of silently swallowing them
    this.executeRelease(release.id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Release ${release.id} execution failed: ${msg}`);
    });

    return release;
  }

  findAll() {
    return this.prisma.release.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        steps: true,
        createdBy: { select: { username: true } },
        template: { select: { name: true, protocol: true } },
      },
    });
  }

  async findOne(id: string) {
    const release = await this.prisma.release.findUnique({
      where: { id },
      include: {
        steps: { include: { server: { select: { name: true, ip: true } } } },
        createdBy: { select: { username: true } },
        template: true,
      },
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    return release;
  }

  async rollback(id: string) {
    const release = await this.findOne(id);
    // Mark release as rolled back and trigger reverse steps
    await this.prisma.release.update({
      where: { id },
      data: { status: 'ROLLED_BACK' },
    });
    return { message: `Release ${release.id} marked for rollback` };
  }

  /**
   * Stub: real implementation will SSH into servers via ServersService
   * and apply the rendered template config, then update step statuses.
   */
  private async executeRelease(releaseId: string) {
    try {
      await this.prisma.release.update({
        where: { id: releaseId },
        data: { status: 'RUNNING' },
      });

      const steps = await this.prisma.releaseStep.findMany({
        where: { releaseId },
      });

      let allSuccess = true;
      for (const step of steps) {
        await this.prisma.releaseStep.update({
          where: { id: step.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        });

        // TODO: actually SSH and deploy in a future iteration
        const success = true;

        await this.prisma.releaseStep.update({
          where: { id: step.id },
          data: {
            status: success ? 'SUCCESS' : 'FAILED',
            endedAt: new Date(),
            log: success ? 'Deployed successfully (stub)' : 'Deployment failed',
          },
        });

        if (!success) {
          allSuccess = false;
          break;
        }
      }

      await this.prisma.release.update({
        where: { id: releaseId },
        data: { status: allSuccess ? 'SUCCESS' : 'FAILED' },
      });
    } catch {
      await this.prisma.release.update({
        where: { id: releaseId },
        data: { status: 'FAILED' },
      });
    }
  }
}
