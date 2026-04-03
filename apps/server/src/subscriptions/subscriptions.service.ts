import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
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

  async create(name: string, nodeIds: string[], ownerId: string, externalNodeIds?: string[]) {
    // Filter out non-existent IDs to prevent FK constraint violations
    let validNodeIds = nodeIds;
    if (nodeIds.length > 0) {
      const existing = await this.prisma.node.findMany({
        where: { id: { in: nodeIds }, userId: ownerId },
        select: { id: true },
      });
      validNodeIds = existing.map((n) => n.id);
    }

    let validExternalNodeIds = externalNodeIds;
    if (externalNodeIds?.length) {
      const existing = await this.prisma.externalNode.findMany({
        where: { id: { in: externalNodeIds }, userId: ownerId },
        select: { id: true },
      });
      validExternalNodeIds = existing.map((n) => n.id);
    }

    return this.prisma.subscription.create({
      data: {
        name,
        ownerId,
        nodes: {
          create: validNodeIds.map((nodeId) => ({ nodeId })),
        },
        ...(validExternalNodeIds?.length && {
          externalNodes: {
            create: validExternalNodeIds.map((externalNodeId) => ({ externalNodeId })),
          },
        }),
      },
      include: {
        nodes: { include: { node: true } },
        externalNodes: { include: { externalNode: true } },
      },
    });
  }

  findAll(ownerId: string) {
    return this.prisma.subscription.findMany({
      where: { ownerId },
      include: {
        nodes: {
          include: {
            node: { select: { id: true, name: true, protocol: true, status: true, enabled: true, listenPort: true, serverId: true, server: { select: { id: true, name: true, ip: true, tags: true, autoTags: true } } } },
          },
        },
        externalNodes: {
          include: {
            externalNode: { select: { id: true, name: true, protocol: true, address: true, port: true } },
          },
        },
        shares: { select: { id: true, userId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** List subscriptions shared with a VIEWER user */
  async findSharedWith(userId: string) {
    const shares = await this.prisma.subscriptionShare.findMany({
      where: { userId },
      include: {
        subscription: {
          include: {
            nodes: {
              include: {
                node: { select: { id: true, name: true, protocol: true, status: true, enabled: true, listenPort: true, serverId: true, server: { select: { id: true, name: true, ip: true, tags: true, autoTags: true } } } },
              },
            },
            externalNodes: {
              include: {
                externalNode: { select: { id: true, name: true, protocol: true, address: true, port: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return shares.map((s) => ({ ...s.subscription, shareToken: s.shareToken }));
  }

  // ─── Share management ─────────────────────────────────────────────────────

  async addShare(subscriptionId: string, userId: string, ownerId: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id: subscriptionId, ownerId } });
    if (!sub) throw new NotFoundException(`Subscription ${subscriptionId} not found`);

    const existing = await this.prisma.subscriptionShare.findUnique({
      where: { subscriptionId_userId: { subscriptionId, userId } },
    });
    if (existing) throw new ConflictException('Already shared with this user');

    return this.prisma.subscriptionShare.create({
      data: { subscriptionId, userId },
      include: { user: { select: { id: true, username: true, role: true } } },
    });
  }

  async removeShare(subscriptionId: string, userId: string, ownerId: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id: subscriptionId, ownerId } });
    if (!sub) throw new NotFoundException(`Subscription ${subscriptionId} not found`);

    const share = await this.prisma.subscriptionShare.findUnique({
      where: { subscriptionId_userId: { subscriptionId, userId } },
    });
    if (!share) throw new NotFoundException('Share not found');

    return this.prisma.subscriptionShare.delete({ where: { id: share.id } });
  }

  async listShares(subscriptionId: string, ownerId: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { id: subscriptionId, ownerId } });
    if (!sub) throw new NotFoundException(`Subscription ${subscriptionId} not found`);

    return this.prisma.subscriptionShare.findMany({
      where: { subscriptionId },
      include: { user: { select: { id: true, username: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, name: string | undefined, nodeIds: string[] | undefined, ownerId: string, externalNodeIds?: string[]) {
    const sub = await this.prisma.subscription.findFirst({ where: { id, ownerId } });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);

    // Filter out non-existent node IDs to prevent FK constraint violations
    let validNodeIds = nodeIds;
    if (nodeIds !== undefined && nodeIds.length > 0) {
      const existing = await this.prisma.node.findMany({
        where: { id: { in: nodeIds }, userId: ownerId },
        select: { id: true },
      });
      validNodeIds = existing.map((n) => n.id);
    }

    let validExternalNodeIds = externalNodeIds;
    if (externalNodeIds !== undefined && externalNodeIds.length > 0) {
      const existing = await this.prisma.externalNode.findMany({
        where: { id: { in: externalNodeIds }, userId: ownerId },
        select: { id: true },
      });
      validExternalNodeIds = existing.map((n) => n.id);
    }

    return this.prisma.subscription.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(validNodeIds !== undefined && {
          nodes: {
            deleteMany: {},
            create: validNodeIds.map((nodeId) => ({ nodeId })),
          },
        }),
        ...(validExternalNodeIds !== undefined && {
          externalNodes: {
            deleteMany: {},
            create: validExternalNodeIds.map((externalNodeId) => ({ externalNodeId })),
          },
        }),
      },
      include: {
        nodes: { include: { node: { select: { id: true, name: true, protocol: true } } } },
        externalNodes: { include: { externalNode: { select: { id: true, name: true, protocol: true } } } },
      },
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
    const nodes = await this.fetchActiveNodes({ token });
    const lines = nodes.map((n) => buildShareUri(n)).filter((u): u is string => u !== null);
    return Buffer.from(lines.join('\n')).toString('base64');
  }

  /** Clash / Mihomo YAML subscription */
  async generateClashContent(token: string): Promise<{ content: string; name: string }> {
    const sub = await this.prisma.subscription.findUnique({ where: { token }, select: { name: true } });
    const nodes = await this.fetchActiveNodes({ token });
    const panelUrl = this.config.get<string>('PANEL_URL') ?? 'http://localhost:3001';
    return { content: buildClashSubscription(nodes, panelUrl), name: sub?.name ?? 'clash' };
  }

  /** Sing-box JSON subscription */
  async generateSingboxContent(token: string): Promise<string> {
    const nodes = await this.fetchActiveNodes({ token });

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

  /** Base64-encoded subscription via shareToken (VIEWER) */
  async generateContentByShareToken(shareToken: string): Promise<string> {
    const nodes = await this.fetchActiveNodes({ shareToken });
    const lines = nodes.map((n) => buildShareUri(n)).filter((u): u is string => u !== null);
    return Buffer.from(lines.join('\n')).toString('base64');
  }

  /** Clash YAML via shareToken (VIEWER) */
  async generateClashContentByShareToken(shareToken: string): Promise<{ content: string; name: string }> {
    const share = await this.prisma.subscriptionShare.findUnique({
      where: { shareToken },
      include: { subscription: { select: { name: true } } },
    });
    if (!share) throw new NotFoundException('Share not found');
    const nodes = await this.fetchActiveNodes({ shareToken });
    const panelUrl = this.config.get<string>('PANEL_URL') ?? 'http://localhost:3001';
    return { content: buildClashSubscription(nodes, panelUrl), name: share.subscription.name };
  }

  /** Sing-box JSON via shareToken (VIEWER) */
  async generateSingboxContentByShareToken(shareToken: string): Promise<string> {
    const nodes = await this.fetchActiveNodes({ shareToken });

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
      route: { final: '🚀 节点选择' },
    };

    return JSON.stringify(config, null, 2);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async fetchActiveNodes(by: { token?: string; shareToken?: string }): Promise<NodeExportInfo[]> {
    const include = {
      nodes: {
        include: {
          node: { include: { server: { select: { ip: true } } } },
        },
      },
      externalNodes: { include: { externalNode: true } },
    };

    let sub: { ownerId: string; nodes: SubscriptionNode[]; externalNodes: { externalNode: { name: string; protocol: string; address: string; port: number; transport: string | null; tls: string; sni: string | null; path: string | null; uuid: string | null; password: string | null; method: string | null } }[] } | null = null;

    if (by.shareToken) {
      const share = await this.prisma.subscriptionShare.findUnique({
        where: { shareToken: by.shareToken },
        include: { subscription: { include } },
      });
      if (!share) throw new NotFoundException('Share not found');
      sub = share.subscription;
    } else if (by.token) {
      sub = await this.prisma.subscription.findUnique({ where: { token: by.token }, include });
    }

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

    for (const { externalNode: en } of sub.externalNodes as { externalNode: { name: string; protocol: string; address: string; port: number; transport: string | null; tls: string; sni: string | null; path: string | null; uuid: string | null; password: string | null; method: string | null; realityPublicKey: string | null } }[]) {
      const credentials: Record<string, string> = {};
      if (en.uuid) credentials.uuid = en.uuid;
      if (en.password) credentials.password = en.password;
      if (en.method) credentials.method = en.method;
      if (en.realityPublicKey) credentials.realityPublicKey = en.realityPublicKey;
      result.push({
        name: en.name,
        protocol: en.protocol,
        host: en.address,
        port: en.port,
        transport: en.transport,
        tls: en.tls,
        domain: en.sni,
        credentials,
      });
    }

    return result;
  }
}
