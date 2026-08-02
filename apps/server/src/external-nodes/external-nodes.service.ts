import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { XrayTestService, type TestResult } from '../nodes/xray-test/xray-test.service';
import { SingboxTestService } from '../nodes/singbox-test/singbox-test.service';
import { parseSubscriptionText } from './uri-parser';
import { SocksExitResolverService } from '../nodes/socks-exit-resolver.service';

@Injectable()
export class ExternalNodesService {
  private readonly logger = new Logger(ExternalNodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xrayTest: XrayTestService,
    private readonly singboxTest: SingboxTestService,
    private readonly socksExitResolver: SocksExitResolverService,
  ) {}

  list(userId: string) {
    return this.prisma.externalNode.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async resolveText(text: string): Promise<string> {
    const trimmed = text.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      this.logger.log(`Fetching subscription URL: ${trimmed}`);
      const res = await fetch(trimmed, {
        headers: { 'User-Agent': 'ClashForAndroid/2.5.12' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        throw new BadRequestException(`订阅链接请求失败：HTTP ${res.status}`);
      }
      return await res.text();
    }
    return trimmed;
  }

  async import(userId: string, text: string) {
    const resolved = await this.resolveText(text);
    const { nodes, failed } = parseSubscriptionText(resolved);
    if (nodes.length === 0) {
      return { success: 0, failed, errors: ['未能解析出任何有效节点'] };
    }

    const created = await this.prisma.externalNode.createMany({
      data: nodes.map((n) => ({
        userId,
        name: n.name,
        protocol: n.protocol,
        address: n.address,
        port: n.port,
        uuid: n.uuid,
        username: n.username,
        password: n.password,
        method: n.method,
        transport: n.transport,
        tls: n.tls,
        realityPublicKey: n.realityPublicKey,
        shortId: n.shortId,
        xhttpMode: n.xhttpMode,
        xhttpHost: n.xhttpHost,
        xhttpExtra: n.xhttpExtra,
        sni: n.sni,
        path: n.path,
        rawUri: n.rawUri,
      })),
    });

    return { success: created.count, failed, errors: [] };
  }

  async test(id: string, userId: string) {
    const node = await this.prisma.externalNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException(`ExternalNode ${id} not found`);
    if (node.userId !== userId) throw new ForbiddenException();

    const credentials: Record<string, string> = {};
    if (node.uuid) credentials.uuid = node.uuid;
    if (node.username) credentials.username = node.username;
    if (node.password) credentials.password = node.password;
    if (node.method) credentials.method = node.method;
    if (node.realityPublicKey) credentials.realityPublicKey = node.realityPublicKey;
    if (node.shortId) credentials.shortId = node.shortId;
    if (node.path) credentials.path = node.path;
    if (node.xhttpMode) credentials.xhttpMode = node.xhttpMode;
    if (node.xhttpHost) credentials.xhttpHost = node.xhttpHost;
    if (node.xhttpExtra) credentials.xhttpExtra = node.xhttpExtra;

    let result: TestResult | undefined;
    if (node.protocol === 'HYSTERIA2') {
      result = await this.singboxTest.testHysteria2({
        host: node.address,
        port: node.port,
        domain: node.sni ?? null,
        credentials,
      });
    } else if (node.protocol === 'SOCKS5') {
      const resolution = await this.socksExitResolver.resolve(node.address, []);
      const candidates = Array.from(new Set([
        ...resolution.candidates.map((candidate) => candidate.address),
        node.address,
      ]));
      for (const host of candidates) {
        result = await this.xrayTest.testWithParams({
          protocol: node.protocol,
          transport: node.transport,
          tls: node.tls,
          host,
          port: node.port,
          domain: null,
          credentials,
        });
        if (result.reachable) break;
      }
    } else {
      result = await this.xrayTest.testWithParams({
        protocol: node.protocol,
        transport: node.transport,
        tls: node.tls,
        host: node.address,
        port: node.port,
        domain: node.sni ?? null,
        credentials,
      });
    }

    if (!result) throw new Error('SOCKS5 节点没有可测试的候选地址');

    // Persist result
    await this.prisma.externalNode.update({
      where: { id },
      data: {
        lastReachable: result.reachable,
        lastLatency: result.reachable ? result.latency : null,
        lastTestedAt: new Date(result.testedAt),
      },
    });

    return result;
  }

  async remove(id: string, userId: string) {
    const node = await this.prisma.externalNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException(`ExternalNode ${id} not found`);
    if (node.userId !== userId) throw new ForbiddenException();
    await this.prisma.externalNode.delete({ where: { id } });
  }
}
