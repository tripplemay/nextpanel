import { Injectable, Optional, NotFoundException, ForbiddenException, ConflictException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { NodesService } from '../nodes/nodes.service';
import { buildShareUri, buildClashSubscription, buildClashProxy, buildSingboxOutbound, buildFullSingboxConfig, buildHomeProxyConfig, buildCfUnavailableProvider } from './uri-builder';
import type { NodeExportInfo } from './uri-builder';
import { importedTransportHost } from '../external-nodes/uri-parser';
import { CryptoService } from '../common/crypto/crypto.service';
import { externalNodePublicSelect, openExternalSecrets } from '../external-nodes/external-credentials';
import { CfAccessService } from './cf-access.service';
import { assertCfManagedNode, cfVariants, normalizeCfPreferredIps } from './cf-access.util';
import { CfOptimizationService } from './cf-optimization.service';

type CfOptions = { cfOnly?: boolean; cfPreferredIps?: string[]; cfAuto?: boolean };

type SubscriptionNode = {
  node: {
    id: string;
    userId: string;
    name: string;
    protocol: string;
    implementation: string | null;
    transport: string | null;
    tls: string;
    listenPort: number;
    domain: string | null;
    cfDnsRecordId?: string | null;
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
    private crypto: CryptoService,
    private cfAccess: CfAccessService,
    @Optional() private cfOptimizer?: CfOptimizationService,
  ) {}

  async create(name: string, nodeIds: string[], ownerId: string, externalNodeIds?: string[], options: CfOptions = {}) {
    const cfPreferredIps = normalizeCfPreferredIps(options.cfPreferredIps ?? []);
    if (options.cfAuto && !options.cfOnly) throw new BadRequestException('Automatic optimization requires CF-only mode');
    if (options.cfOnly) await this.cfAccess.validateSelection(nodeIds, externalNodeIds ?? [], ownerId);
    else if (cfPreferredIps.length) throw new BadRequestException('Preferred IPs require CF-only mode');
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
        cfOnly: options.cfOnly ?? false,
        cfAuto: options.cfAuto ?? false,
        cfPreferredIps,
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
        externalNodes: { include: { externalNode: { select: externalNodePublicSelect } } },
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
    return shares.map((s) => ({
      id: s.subscription.id,
      name: s.subscription.name,
      createdAt: s.subscription.createdAt,
      updatedAt: s.subscription.updatedAt,
      nodes: s.subscription.cfOnly ? s.subscription.nodes.map(({ node }) => ({
        node: { ...node, server: { ...node.server, ip: undefined } },
      })) : s.subscription.nodes,
      externalNodes: s.subscription.externalNodes,
      cfOnly: s.subscription.cfOnly,
      cfAuto: s.subscription.cfAuto,
      cfPreferredIps: s.subscription.cfPreferredIps,
      shareToken: s.shareToken,
    }));
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

  async update(id: string, name: string | undefined, nodeIds: string[] | undefined, ownerId: string, externalNodeIds?: string[], options: CfOptions = {}) {
    const sub = await this.prisma.subscription.findFirst({
      where: { id, ownerId },
      include: { nodes: { select: { nodeId: true } }, externalNodes: { select: { externalNodeId: true } } },
    });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    if (sub.cfOnly && options.cfOnly === false) {
      throw new BadRequestException('CF-only cannot be disabled; clear preferred IPs to restore default CDN access');
    }
    const cfOnly = options.cfOnly ?? sub.cfOnly ?? false;
    const cfAuto = options.cfAuto ?? sub.cfAuto ?? false;
    if (cfAuto && !cfOnly) throw new BadRequestException('Automatic optimization requires CF-only mode');
    const cfPreferredIps = normalizeCfPreferredIps(options.cfPreferredIps ?? sub.cfPreferredIps ?? []);
    if (cfOnly) {
      await this.cfAccess.validateSelection(
        nodeIds ?? sub.nodes.map((n) => n.nodeId),
        externalNodeIds ?? sub.externalNodes.map((n) => n.externalNodeId), ownerId,
      );
    } else if (cfPreferredIps.length) throw new BadRequestException('Preferred IPs require CF-only mode');

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
      where: { id, ...(options.cfOnly === false && { cfOnly: false }) },
      data: {
        ...(options.cfOnly !== undefined && { cfOnly }),
        ...(options.cfAuto !== undefined && { cfAuto }),
        ...(options.cfPreferredIps !== undefined && { cfPreferredIps }),
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
    return { content: buildClashSubscription(nodes, panelUrl, `${panelUrl.replace(/\/$/, '')}/api/subscriptions/link/${encodeURIComponent(token)}/cf-provider`), name: sub?.name ?? 'clash' };
  }

  /** Sing-box JSON subscription */
  async generateSingboxContent(token: string): Promise<string> {
    const nodes = await this.fetchActiveNodes({ token });
    return buildFullSingboxConfig(nodes);
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
    return { content: buildClashSubscription(nodes, panelUrl, `${panelUrl.replace(/\/$/, '')}/api/subscriptions/share/${encodeURIComponent(shareToken)}/cf-provider`), name: share.subscription.name };
  }

  /** Sing-box JSON via shareToken (VIEWER) */
  async generateSingboxContentByShareToken(shareToken: string): Promise<string> {
    const nodes = await this.fetchActiveNodes({ shareToken });
    return buildFullSingboxConfig(nodes);
  }

  /** HomeProxy (OpenWrt router) full sing-box JSON */
  async generateHomeProxyContent(token: string): Promise<string> {
    const nodes = await this.fetchActiveNodes({ token });
    return buildHomeProxyConfig(nodes);
  }

  async generateHomeProxyContentByShareToken(shareToken: string): Promise<string> {
    return buildHomeProxyConfig(await this.fetchActiveNodes({ shareToken }));
  }

  async generateCfProvider(by: { token?: string; shareToken?: string }, nodeId: string): Promise<string> {
    const nodes = await this.fetchActiveNodes(by, nodeId);
    if (!nodes.length) return buildCfUnavailableProvider(nodeId);
    return ['proxies:', ...nodes.map(n => buildClashProxy(n))].join('\n');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async fetchActiveNodes(by: { token?: string; shareToken?: string }, providerNodeId?: string): Promise<NodeExportInfo[]> {
    const include = {
      nodes: {
        include: {
          node: {
            include: {
              server: { select: { ip: true } },
            },
          },
        },
      },
      externalNodes: { include: { externalNode: true } },
    };

    let sub: { ownerId: string; cfOnly?: boolean; cfAuto?: boolean; cfPreferredIps?: string[]; nodes: SubscriptionNode[]; externalNodes: { externalNode: import('@prisma/client').ExternalNode }[] } | null = null;

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
    if (providerNodeId !== undefined && (!sub.cfOnly || !sub.cfAuto
      || !sub.nodes.some(({ node }) => node.id === providerNodeId && node.userId === sub.ownerId))) {
      throw new NotFoundException('CF provider not available');
    }

    const result: NodeExportInfo[] = [];
    const preferredIps = sub.cfOnly ? normalizeCfPreferredIps(sub.cfPreferredIps ?? []) : [];
    if (sub.cfOnly && (sub.externalNodes.length > 0 || sub.nodes.length > 20)) {
      throw new ServiceUnavailableException('CF-only subscription selection is invalid');
    }
    const activeNodes = sub.nodes.filter(({ node }) => node.enabled && node.status === 'RUNNING'
      && (providerNodeId === undefined || node.id === providerNodeId));
    let defaultIps = new Map<string, string | null>();
    if (sub.cfOnly) {
      activeNodes.forEach(({ node }) => assertCfManagedNode(node));
      const domains = [...new Set(activeNodes.map(({ node }) => node.domain!))];
      defaultIps = new Map(await Promise.all(domains.map(async (domain) => [domain, await this.cfAccess.defaultIp(domain)] as const)));
    }

    for (const { node } of activeNodes) {
      const credentials = await this.nodesService.getCredentials(node.id, sub.ownerId);
      const exported: NodeExportInfo = {
        name: node.name,
        protocol: node.protocol,
        host: node.tls === 'REALITY' ? node.server.ip : (node.domain ?? node.server.ip),
        port: node.listenPort,
        transport: node.transport,
        tls: node.tls,
        domain: node.domain,
        credentials,
      };
      if (sub.cfOnly) {
        const defaultIp = defaultIps.get(node.domain!) ?? null;
        if (sub.cfAuto && !this.cfOptimizer) throw new ServiceUnavailableException('CF optimization unavailable');
        const variants = sub.cfAuto ? await this.cfOptimizer!.variants(exported, node, defaultIp)
          : cfVariants(exported, node.id, preferredIps, defaultIp);
        if (variants.length === 0 && providerNodeId === undefined) throw new ServiceUnavailableException('No Cloudflare endpoint available; direct fallback is forbidden');
        result.push(...variants);
      } else result.push(exported);
    }

    for (const { externalNode: stored } of sub.externalNodes) {
      if (stored.userId !== sub.ownerId) throw new ForbiddenException();
      const en = { ...stored, ...openExternalSecrets(this.crypto, stored) };
      const credentials: Record<string, string> = {};
      if (en.uuid) credentials.uuid = en.uuid;
      if (en.username) credentials.username = en.username;
      if (en.password) credentials.password = en.password;
      if (en.method) credentials.method = en.method;
      if (en.realityPublicKey) credentials.realityPublicKey = en.realityPublicKey;
      if (en.shortId) credentials.shortId = en.shortId;
      if (en.path != null) credentials.path = en.path;
      const transportHost = importedTransportHost(en);
      if (transportHost !== undefined) credentials.transportHost = transportHost;
      if (en.xhttpMode) credentials.xhttpMode = en.xhttpMode;
      if (en.xhttpHost) credentials.xhttpHost = en.xhttpHost;
      if (en.xhttpExtra) credentials.xhttpExtra = en.xhttpExtra;
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

    if (sub.cfOnly && result.length === 0 && providerNodeId === undefined) {
      throw new ServiceUnavailableException('No active CF-only nodes; direct fallback is forbidden');
    }
    return result;
  }
}
