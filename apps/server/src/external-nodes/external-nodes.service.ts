import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { XrayTestService } from '../nodes/xray-test/xray-test.service';
import { SingboxTestService } from '../nodes/singbox-test/singbox-test.service';
import { parseSubscriptionText } from './uri-parser';

@Injectable()
export class ExternalNodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xrayTest: XrayTestService,
    private readonly singboxTest: SingboxTestService,
  ) {}

  list(userId: string) {
    return this.prisma.externalNode.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async import(userId: string, text: string) {
    const { nodes, failed } = parseSubscriptionText(text);
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
        password: n.password,
        method: n.method,
        transport: n.transport,
        tls: n.tls,
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
    if (node.password) credentials.password = node.password;
    if (node.method) credentials.method = node.method;

    let result;
    if (node.protocol === 'HYSTERIA2') {
      result = await this.singboxTest.testHysteria2({
        host: node.address,
        port: node.port,
        domain: node.sni ?? null,
        credentials,
      });
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
