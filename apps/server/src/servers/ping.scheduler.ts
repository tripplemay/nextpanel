import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as net from 'net';
import { PrismaService } from '../prisma.service';

@Injectable()
export class PingScheduler {
  private readonly logger = new Logger(PingScheduler.name);

  constructor(private prisma: PrismaService) {}

  @Interval(30_000)
  async pingAllServers() {
    const servers = await this.prisma.server.findMany({
      select: { id: true, ip: true, sshPort: true },
    });

    await Promise.allSettled(
      servers.map(async (server) => {
        const ms = await this.tcpPing(server.ip, server.sshPort);
        await this.prisma.server.update({
          where: { id: server.id },
          data: { pingMs: ms },
        });
      }),
    );

    this.logger.debug(`Pinged ${servers.length} servers`);
  }

  private tcpPing(host: string, port: number, timeoutMs = 5000): Promise<number | null> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = net.createConnection({ host, port });
      socket.setTimeout(timeoutMs);
      socket.on('connect', () => {
        const elapsed = Date.now() - start;
        socket.destroy();
        resolve(elapsed);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(null);
      });
      socket.on('error', () => {
        resolve(null);
      });
    });
  }
}
