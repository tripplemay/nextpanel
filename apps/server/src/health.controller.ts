import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() { return { status: 'ok' }; }

  @Get('ready')
  async ready() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 2000); }),
      ]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database not ready');
    } finally { clearTimeout(timer); }
  }
}
