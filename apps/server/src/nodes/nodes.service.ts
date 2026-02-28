import * as net from 'net';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from './node-deploy.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private nodeDeploy: NodeDeployService,
  ) {}

  async create(dto: CreateNodeDto) {
    const credentialsEnc = this.crypto.encrypt(
      JSON.stringify(dto.credentials),
    );
    const node = await this.prisma.node.create({
      data: {
        serverId: dto.serverId,
        name: dto.name,
        protocol: dto.protocol,
        implementation: dto.implementation,
        transport: dto.transport,
        tls: dto.tls ?? 'NONE',
        listenPort: dto.listenPort,
        domain: dto.domain,
        credentialsEnc,
        enabled: dto.enabled ?? true,
      },
      select: this.safeSelect(),
    });
    // Deploy asynchronously — log errors instead of silently swallowing them
    this.nodeDeploy.deploy(node.id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Node ${node.id} deploy failed: ${msg}`);
    });
    return node;
  }

  async findAll(serverId?: string) {
    return this.prisma.node.findMany({
      where: serverId ? { serverId } : undefined,
      select: this.safeSelect(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const node = await this.prisma.node.findUnique({
      where: { id },
      select: this.safeSelect(),
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);
    return node;
  }

  async update(id: string, dto: UpdateNodeDto) {
    await this.findOne(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.credentials) {
      data.credentialsEnc = this.crypto.encrypt(
        JSON.stringify(dto.credentials),
      );
      delete data.credentials;
    }
    const node = await this.prisma.node.update({
      where: { id },
      data,
      select: this.safeSelect(),
    });
    // Re-deploy to apply updated config
    this.nodeDeploy.deploy(id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Node ${id} redeploy failed: ${msg}`);
    });
    return node;
  }

  async remove(id: string) {
    await this.findOne(id);
    // Best-effort cleanup on the server before DB deletion
    this.nodeDeploy.undeploy(id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Node ${id} undeploy failed: ${msg}`);
    });
    return this.prisma.node.delete({ where: { id } });
  }

  async testConnectivity(id: string): Promise<{ reachable: boolean; latency: number; message: string }> {
    const node = await this.prisma.node.findUnique({
      where: { id },
      include: { server: { select: { ip: true } } },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);

    const host = node.server.ip;
    const port = node.listenPort;
    const start = Date.now();

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.setTimeout(5000);

      socket.once('connect', () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ reachable: true, latency, message: `连接成功，延迟 ${latency}ms` });
      });

      const fail = (err: Error) => {
        socket.destroy();
        resolve({ reachable: false, latency: -1, message: err.message });
      };

      socket.once('error', fail);
      socket.once('timeout', () => fail(new Error('连接超时（5s）')));
    });
  }

  /** Decrypt credentials — only use when generating subscription / deploying */
  async getCredentials(id: string): Promise<Record<string, string>> {
    const node = await this.prisma.node.findUnique({
      where: { id },
      select: { credentialsEnc: true },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);
    return JSON.parse(this.crypto.decrypt(node.credentialsEnc)) as Record<string, string>;
  }

  private safeSelect() {
    return {
      id: true,
      serverId: true,
      name: true,
      protocol: true,
      implementation: true,
      transport: true,
      tls: true,
      listenPort: true,
      domain: true,
      status: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}
