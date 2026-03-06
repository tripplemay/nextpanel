import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { NodesService } from '../nodes/nodes.service';
import { buildShareUri, buildClashSubscription, buildSingboxOutbound } from './uri-builder';
import type { NodeExportInfo } from './uri-builder';

type SubscriptionNode = {
  node: {
    id: string;
    name: string;
    protocol: string;
    implementation: string | null;
    transport: string | null;
    tls: string;
    listenPort: number;
    domain: string | null;
    enabled: boolean;
    status: string;
    server: { ip: string };
  };
};

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private nodesService: NodesService,
    private config: ConfigService,
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
      include: {
        nodes: {
          include: {
            node: { select: { id: true, name: true, protocol: true, status: true, enabled: true, listenPort: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, name: string | undefined, nodeIds: string[] | undefined, ownerId: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id, ownerId } });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);

    return this.prisma.subscription.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(nodeIds !== undefined && {
          nodes: {
            deleteMany: {},
            create: nodeIds.map((nodeId) => ({ nodeId })),
          },
        }),
      },
      include: { nodes: { include: { node: { select: { id: true, name: true, protocol: true } } } } },
    });
  }

  async refreshToken(id: string, ownerId: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id, ownerId } });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    if (sub.ownerId !== ownerId) throw new ForbiddenException();

    return this.prisma.subscription.update({
      where: { id },
      data: { token: require('crypto').randomUUID() },
      select: { id: true, token: true },
    });
  }

  async remove(id: string, ownerId: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id, ownerId } });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    return this.prisma.subscription.delete({ where: { id } });
  }

  /** Base64-encoded subscription (V2Ray / Xray universal format) */
  async generateContent(token: string): Promise<string> {
    const nodes = await this.fetchActiveNodes(token);
    const lines = nodes.map((n) => buildShareUri(n)).filter((u): u is string => u !== null);
    return Buffer.from(lines.join('\n')).toString('base64');
  }

  /** Clash / Mihomo YAML subscription */
  async generateClashContent(token: string): Promise<{ content: string; name: string }> {
    const sub = await this.prisma.subscription.findUnique({ where: { token }, select: { name: true } });
    const nodes = await this.fetchActiveNodes(token);
    const panelUrl = this.config.get<string>('PANEL_URL') ?? 'http://localhost:3001';
    return { content: buildClashSubscription(nodes, panelUrl), name: sub?.name ?? 'clash' };
  }

  /** Sing-box JSON subscription */
  async generateSingboxContent(token: string): Promise<string> {
    const nodes = await this.fetchActiveNodes(token);

    const outbounds = nodes
      .map((n) => buildSingboxOutbound(n))
      .filter((o): o is Record<string, unknown> => o !== null);

    const tags = outbounds.map((o) => o.tag as string);

    const config = {
      log: { level: 'info' },
      outbounds: [
        ...outbounds,
        {
          type: 'selector',
          tag: '🚀 节点选择',
          outbounds: tags.length > 0 ? tags : ['direct'],
          default: tags[0] ?? 'direct',
        },
        { type: 'direct', tag: 'direct' },
        { type: 'block', tag: 'block' },
      ],
      route: {
        final: '🚀 节点选择',
      },
    };

    return JSON.stringify(config, null, 2);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async fetchActiveNodes(token: string): Promise<NodeExportInfo[]> {
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

    const result: NodeExportInfo[] = [];

    for (const { node } of sub.nodes as SubscriptionNode[]) {
      if (!node.enabled || node.status !== 'RUNNING') continue;
      const credentials = await this.nodesService.getCredentials(node.id, sub.ownerId);
      result.push({
        name: node.name,
        protocol: node.protocol,
        host: node.domain ?? node.server.ip,
        port: node.listenPort,
        transport: node.transport,
        tls: node.tls,
        domain: node.domain,
        credentials,
      });
    }

    return result;
  }
}
