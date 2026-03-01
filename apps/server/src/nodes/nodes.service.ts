import * as net from 'net';
import * as crypto from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from './node-deploy.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { buildShareUri } from '../subscriptions/uri-builder';

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private nodeDeploy: NodeDeployService,
  ) {}

  async create(dto: CreateNodeDto) {
    const creds = { ...dto.credentials };
    if (dto.tls === 'REALITY' && !creds.realityPrivateKey) {
      Object.assign(creds, generateRealityKeys());
    }
    const credentialsEnc = this.crypto.encrypt(JSON.stringify(creds));
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
    const existing = await this.prisma.node.findUnique({
      where: { id },
      select: { tls: true, credentialsEnc: true },
    });
    if (!existing) throw new NotFoundException(`Node ${id} not found`);

    const data: Record<string, unknown> = { ...dto };
    const effectiveTls = dto.tls ?? existing.tls;

    if (effectiveTls === 'REALITY') {
      // Decrypt current creds, merge with incoming, then ensure reality keys exist
      const currentCreds = JSON.parse(
        this.crypto.decrypt(existing.credentialsEnc),
      ) as Record<string, string>;
      const merged = { ...currentCreds, ...(dto.credentials ?? {}) };
      if (!merged.realityPrivateKey) {
        Object.assign(merged, generateRealityKeys());
      }
      data.credentialsEnc = this.crypto.encrypt(JSON.stringify(merged));
      delete data.credentials;
    } else if (dto.credentials) {
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
    // Undeploy MUST succeed before DB deletion — errors propagate to caller.
    await this.nodeDeploy.undeploy(id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Node ${id} undeploy failed, aborting deletion: ${msg}`);
      throw err;
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

  /** Build a single-node share URI (vmess://, vless://, etc.) */
  async getShareLink(id: string): Promise<string | null> {
    const node = await this.prisma.node.findUnique({
      where: { id },
      include: { server: { select: { ip: true } } },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);
    const credentials = await this.getCredentials(id);
    return buildShareUri({
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

  async getLatestSnapshot(nodeId: string) {
    return this.prisma.configSnapshot.findFirst({
      where: { nodeId },
      orderBy: { version: 'desc' },
      select: { version: true, deployLog: true, createdAt: true },
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

/**
 * Generate an X25519 key pair in Xray's base64url format.
 * PKCS8 DER for X25519: 48 bytes, raw key starts at offset 16.
 * SPKI  DER for X25519: 44 bytes, raw key starts at offset 12.
 */
function generateRealityKeys(): { realityPrivateKey: string; realityPublicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const pubDer  = publicKey.export({ type: 'spki',  format: 'der' }) as Buffer;
  return {
    realityPrivateKey: privDer.slice(16).toString('base64url'),
    realityPublicKey:  pubDer.slice(12).toString('base64url'),
  };
}
