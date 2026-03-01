import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NodesService } from '../nodes/nodes.service';
import { buildShareUri, buildClashProxy, buildSingboxOutbound } from './uri-builder';
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

  /** Base64-encoded subscription (V2Ray / Xray universal format) */
  async generateContent(token: string): Promise<string> {
    const nodes = await this.fetchActiveNodes(token);
    const lines = nodes.map((n) => buildShareUri(n)).filter((u): u is string => u !== null);
    return Buffer.from(lines.join('\n')).toString('base64');
  }

  /** Clash / Mihomo YAML subscription */
  async generateClashContent(token: string): Promise<string> {
    const nodes = await this.fetchActiveNodes(token);

    const proxyBlocks = nodes
      .map((n) => buildClashProxy(n))
      .filter((b): b is string => b !== null);

    if (proxyBlocks.length === 0) {
      return 'proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n';
    }

    const names = nodes.map((n) => `      - ${n.name}`).join('\n');

    return [
      'proxies:',
      proxyBlocks.join('\n'),
      '',
      'proxy-groups:',
      '  - name: 🚀 节点选择',
      '    type: select',
      '    proxies:',
      names,
      '',
      'rules:',
      '  - MATCH,🚀 节点选择',
      '',
    ].join('\n');
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
      const credentials = await this.nodesService.getCredentials(node.id);
      result.push({
        name: node.name,
        protocol: node.protocol,
        host: node.server.ip,
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
