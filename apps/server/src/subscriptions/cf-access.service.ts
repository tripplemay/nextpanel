import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException, HttpException, HttpStatus } from '@nestjs/common';
import { Resolver } from 'dns/promises';
import { PrismaService } from '../prisma.service';
import { NodesService } from '../nodes/nodes.service';
import { XrayTestService } from '../nodes/xray-test/xray-test.service';
import { assertCfManagedNode, isCfManagedNode, isCloudflareIp, normalizeCfPreferredIps } from './cf-access.util';

@Injectable()
export class CfAccessService {
  private readonly resolver = new Resolver({ timeout: 2000, tries: 1 });
  private readonly cache = new Map<string, { ip: string | null; expires: number }>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly probing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodesService,
    private readonly xray: XrayTestService,
  ) {}

  async defaultIp(domain: string): Promise<string | null> {
    const cached = this.cache.get(domain);
    if (cached && cached.expires > Date.now()) return cached.ip;
    const pending = this.pending.get(domain);
    if (pending) return pending;
    if (this.pending.size >= 32) throw new ServiceUnavailableException('CF DNS resolution capacity exceeded');
    const work = this.resolveDefault(domain).finally(() => this.pending.delete(domain));
    this.pending.set(domain, work);
    return work;
  }

  private async resolveDefault(domain: string): Promise<string | null> {
    // Pin the checked address in exports: a later gray-cloud/DNS change cannot
    // turn an already downloaded subscription into a direct origin connection.
    const records = [
      ...await this.resolver.resolve4(domain, { ttl: true }).catch(() => []),
      ...await this.resolver.resolve6(domain, { ttl: true }).catch(() => []),
    ];
    const allCf = records.length > 0 && records.every((record) => isCloudflareIp(record.address));
    const ip = allCf ? normalizeCfPreferredIps([records[0].address])[0] : null;
    const ttl = ip ? Math.min(60, ...records.map((r) => r.ttl)) : 5;
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(domain, { ip, expires: Date.now() + ttl * 1000 });
    return ip;
  }

  async validateSelection(nodeIds: string[], externalNodeIds: string[], ownerId: string): Promise<void> {
    if (nodeIds.length === 0 || nodeIds.length > 20 || externalNodeIds.length > 0) {
      throw new BadRequestException('CF-only subscriptions require 1-20 managed nodes and no external nodes');
    }
    const nodes = await this.prisma.node.findMany({ where: { id: { in: nodeIds }, userId: ownerId } });
    if (nodes.length !== new Set(nodeIds).size) throw new BadRequestException('CF node selection is not available');
    nodes.forEach(assertCfManagedNode);
  }

  async automaticSelection(nodeIds: string[], ownerId: string): Promise<string[]> {
    const nodes = await this.prisma.node.findMany({ where: { id: { in: nodeIds }, userId: ownerId } });
    if (nodes.length !== new Set(nodeIds).size) throw new BadRequestException('CF node selection is not available');
    const eligible = nodes.filter(isCfManagedNode);
    if (!eligible.length || eligible.length > 20) {
      throw new BadRequestException('Automatic optimization requires 1-20 compatible managed CF nodes; other nodes may remain');
    }
    return eligible.map(node => node.id);
  }

  async inspect(nodeId: string, ownerId: string) {
    const node = await this.prisma.node.findFirst({
      where: { id: nodeId, userId: ownerId },
      include: { server: { select: { ip: true } }, exitServer: { select: { ip: true } } },
    });
    if (!node) throw new NotFoundException('Node not found');
    assertCfManagedNode(node);
    const findings: string[] = [];
    if (!node.exitType || (node.exitType !== 'SOCKS5' && !node.exitServer)) {
      findings.push('ENTRY_IS_EXIT');
    } else if (node.exitType === 'SOCKS5') {
      findings.push('EXTERNAL_EXIT_UNVERIFIED');
    } else if (node.exitServer?.ip === node.server.ip) {
      findings.push('ENTRY_EXIT_SAME_IP');
    }
    const directSibling = await this.prisma.node.findFirst({
      where: {
        userId: ownerId, server: { ip: node.server.ip },
        OR: [{ protocol: { not: 'VLESS' } }, { transport: { not: 'WS' } }, { transport: null }, { tls: { not: 'TLS' } }],
      },
      select: { id: true },
    });
    if (directSibling) findings.push('OTHER_DIRECT_NODE_ON_ENTRY');
    findings.push('DNS_HISTORY_AND_FIREWALL_UNVERIFIED');
    const defaultIp = await this.defaultIp(node.domain!);
    if (!defaultIp) findings.push('DEFAULT_DNS_NOT_CF_OR_UNAVAILABLE');
    return { node, defaultIp, audit: { status: 'UNVERIFIED' as const, findings } };
  }

  async check(nodeId: string, ownerId: string, ip?: string) {
    const endpoint = ip === undefined ? undefined : normalizeCfPreferredIps([ip])[0];
    if (this.probing.has(ownerId) || this.probing.size >= 5) {
      throw new HttpException('A CF check is already running; retry later', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.probing.add(ownerId);
    try {
      const { node, defaultIp, audit } = await this.inspect(nodeId, ownerId);
      const host = endpoint ?? defaultIp;
      if (!host) return {
        reachable: false, latency: -1, message: 'No verified Cloudflare address is available; direct fallback is forbidden',
        testedAt: new Date().toISOString(), address: null, domain: node.domain, vantage: 'PANEL' as const, audit,
      };
      const credentials = await this.nodes.getCredentials(node.id, ownerId);
      const result = await this.xray.testWithParams({
        protocol: node.protocol, transport: node.transport, tls: node.tls,
        host, port: node.listenPort, domain: node.domain,
        credentials: { ...credentials, transportHost: node.domain! },
        secureProbe: true,
        requireUdp: node.exitType === 'SOCKS5',
      });
      return { ...result, address: host, domain: node.domain, vantage: 'PANEL' as const, audit };
    } finally {
      this.probing.delete(ownerId);
    }
  }
}
