import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { XrayTestService, type TestResult } from '../nodes/xray-test/xray-test.service';
import { SingboxTestService } from '../nodes/singbox-test/singbox-test.service';
import { importedTransportHost, parseSubscriptionText, type BareProxyProtocol } from './uri-parser';
import { SocksExitResolverService } from '../nodes/socks-exit-resolver.service';
import { fetchPublicText } from '../common/http/public-fetch';
import { CryptoService } from '../common/crypto/crypto.service';
import { externalNodePublicSelect, openExternalSecrets, sealExternalSecrets } from './external-credentials';

@Injectable()
export class ExternalNodesService {
  private readonly logger = new Logger(ExternalNodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly xrayTest: XrayTestService,
    private readonly singboxTest: SingboxTestService,
    private readonly socksExitResolver: SocksExitResolverService,
    private readonly crypto: CryptoService,
  ) {}

  list(userId: string) {
    return this.prisma.externalNode.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: externalNodePublicSelect,
    });
  }

  private async resolveText(text: string): Promise<string> {
    const trimmed = text.trim();
    if (/^https?:\/\//i.test(trimmed) && !/[\r\n]/.test(trimmed)) {
      let url: URL;
      try { url = new URL(trimmed); } catch { throw new BadRequestException('URL 无效'); }
      // Authenticated proxy URIs and named proxy entries are not subscription endpoints.
      if (url.username || url.password || url.hash) return trimmed;
      return fetchPublicText(trimmed, { userAgent: 'ClashForAndroid/2.5.12' });
    }
    return trimmed;
  }

  async import(userId: string, text: string, bareProtocol: BareProxyProtocol = 'HTTP') {
    const resolved = await this.resolveText(text);
    const protocol: BareProxyProtocol = bareProtocol === 'SOCKS5' ? 'SOCKS5' : 'HTTP';
    const { nodes, failed } = parseSubscriptionText(resolved, protocol);
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
        credentialsEnc: sealExternalSecrets(this.crypto, userId, n),
        method: n.method,
        transport: n.transport,
        transportHost: n.transportHost,
        tls: n.tls,
        realityPublicKey: n.realityPublicKey,
        xhttpMode: n.xhttpMode,
        xhttpHost: n.xhttpHost,
        sni: n.sni,
        path: n.path,
      })),
    });

    return { success: created.count, failed, errors: [] };
  }

  async test(id: string, userId: string) {
    const stored = await this.prisma.externalNode.findUnique({ where: { id } });
    if (!stored) throw new NotFoundException(`ExternalNode ${id} not found`);
    if (stored.userId !== userId) throw new ForbiddenException();
    const node = { ...stored, ...openExternalSecrets(this.crypto, stored) };

    const credentials: Record<string, string> = {};
    if (node.uuid) credentials.uuid = node.uuid;
    if (node.username) credentials.username = node.username;
    if (node.password) credentials.password = node.password;
    if (node.method) credentials.method = node.method;
    if (node.realityPublicKey) credentials.realityPublicKey = node.realityPublicKey;
    if (node.shortId) credentials.shortId = node.shortId;
    if (node.path != null) credentials.path = node.path;
    const transportHost = importedTransportHost(node);
    if (transportHost !== undefined) credentials.transportHost = transportHost;
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

  /** Rename an external node without changing its imported connection data. */
  async rename(id: string, name: string, userId: string) {
    const node = await this.prisma.externalNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException(`ExternalNode ${id} not found`);
    if (node.userId !== userId) throw new ForbiddenException();

    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('节点名称不能为空');
    return this.prisma.externalNode.update({
      where: { id },
      data: { name: trimmed },
      select: externalNodePublicSelect,
    });
  }

  async remove(id: string, userId: string) {
    const node = await this.prisma.externalNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException(`ExternalNode ${id} not found`);
    if (node.userId !== userId) throw new ForbiddenException();
    await this.prisma.externalNode.delete({ where: { id } });
  }

  async getCredentials(id: string, userId: string) {
    const node = await this.prisma.externalNode.findFirst({ where: { id, userId } });
    if (!node) throw new NotFoundException('External node not found');
    return openExternalSecrets(this.crypto, node);
  }
}
