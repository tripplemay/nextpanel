import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NodesService } from '../nodes/nodes.service';
import { Protocol } from '@prisma/client';

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private nodesService: NodesService,
  ) {}

  async create(name: string, nodeIds: string[], ownerId: string) {
    return this.prisma.subscription.create({
      data: {
        name,
        ownerId,
        nodes: {
          create: nodeIds.map((nodeId) => ({ nodeId })),
        },
      },
      include: { nodes: { include: { node: true } } },
    });
  }

  findAll(ownerId: string) {
    return this.prisma.subscription.findMany({
      where: { ownerId },
      include: { nodes: { include: { node: { select: { id: true, name: true, protocol: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    return this.prisma.subscription.delete({ where: { id } });
  }

  /**
   * Generate a Base64-encoded subscription link content (Clash/v2ray format).
   * Each node produces a URI line according to its protocol.
   */
  async generateContent(token: string): Promise<string> {
    const sub = await this.prisma.subscription.findUnique({
      where: { token },
      include: {
        nodes: {
          include: {
            node: {
              include: { server: { select: { ip: true } } },
            },
          },
        },
      },
    });

    if (!sub) throw new NotFoundException('Subscription not found');

    const lines: string[] = [];

    for (const { node } of sub.nodes) {
      if (!node.enabled || node.status !== 'RUNNING') continue;

      const credentials = await this.nodesService.getCredentials(node.id);
      const host = node.domain ?? node.server.ip;

      const uri = this.buildUri(
        node.protocol,
        host,
        node.listenPort,
        node.name,
        credentials,
      );
      if (uri) lines.push(uri);
    }

    return Buffer.from(lines.join('\n')).toString('base64');
  }

  private buildUri(
    protocol: Protocol,
    host: string,
    port: number,
    name: string,
    creds: Record<string, string>,
  ): string | null {
    const tag = encodeURIComponent(name);
    switch (protocol) {
      case 'VMESS': {
        const obj = {
          v: '2',
          ps: name,
          add: host,
          port: String(port),
          id: creds.uuid ?? '',
          aid: '0',
          net: 'tcp',
          type: 'none',
          tls: '',
        };
        return `vmess://${Buffer.from(JSON.stringify(obj)).toString('base64')}`;
      }
      case 'VLESS':
        return `vless://${creds.uuid ?? ''}@${host}:${port}?encryption=none#${tag}`;
      case 'TROJAN':
        return `trojan://${creds.password ?? ''}@${host}:${port}#${tag}`;
      case 'SHADOWSOCKS':
        return `ss://${Buffer.from(`${creds.method ?? 'aes-256-gcm'}:${creds.password ?? ''}`).toString('base64')}@${host}:${port}#${tag}`;
      case 'SOCKS5':
        return `socks5://${host}:${port}#${tag}`;
      case 'HTTP':
        return `http://${host}:${port}#${tag}`;
      default:
        return null;
    }
  }
}
