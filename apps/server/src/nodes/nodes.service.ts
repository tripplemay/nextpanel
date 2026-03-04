import * as crypto from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { NodeDeployService } from './node-deploy.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CloudflareSettingsService } from '../cloudflare/cloudflare-settings.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { CreateNodeFromPresetDto } from './dto/create-node-from-preset.dto';
import { buildShareUri } from '../subscriptions/uri-builder';
import { PROTOCOL_PRESETS, CREDENTIAL_GENERATORS, type SupportedProtocol } from './protocols/presets';

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private nodeDeploy: NodeDeployService,
    private cfService: CloudflareService,
    private cfSettings: CloudflareSettingsService,
  ) {}

  async create(dto: CreateNodeDto) {
    if (dto.tls === 'REALITY' && dto.protocol !== 'VLESS') {
      throw new BadRequestException('REALITY 仅支持 VLESS 协议');
    }
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

  async createFromPreset(userId: string, dto: CreateNodeFromPresetDto) {
    const preset = PROTOCOL_PRESETS[dto.preset as SupportedProtocol];
    const credentials = CREDENTIAL_GENERATORS[dto.preset as SupportedProtocol]();
    const listenPort = await this.pickPort(dto.serverId, preset.fixedPort);
    const credentialsEnc = this.crypto.encrypt(JSON.stringify(credentials));

    const node = await this.prisma.node.create({
      data: {
        serverId: dto.serverId,
        userId,
        name: dto.name,
        protocol: preset.protocol as any,
        implementation: preset.implementation as any,
        transport: preset.transport as any,
        tls: preset.tls as any,
        listenPort,
        domain: null,
        credentialsEnc,
        source: 'AUTO',
      },
      select: this.safeSelect(),
    });

    // Auto-create Cloudflare DNS A record for VLESS+WS+TLS nodes
    if (dto.preset === 'VLESS_WS_TLS') {
      await this.provisionCloudflareDns(userId, node.id, dto.serverId);
    }

    this.nodeDeploy.deploy(node.id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Node ${node.id} deploy failed: ${msg}`);
    });

    return this.findOne(node.id);
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
      select: { protocol: true, tls: true, credentialsEnc: true },
    });
    if (!existing) throw new NotFoundException(`Node ${id} not found`);

    const data: Record<string, unknown> = { ...dto };
    const effectiveProtocol = dto.protocol ?? existing.protocol;
    const effectiveTls = dto.tls ?? existing.tls;

    if (effectiveTls === 'REALITY' && effectiveProtocol !== 'VLESS') {
      throw new BadRequestException('REALITY 仅支持 VLESS 协议');
    }

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
    const node = await this.prisma.node.findUnique({
      where: { id },
      select: { id: true, userId: true, cfDnsRecordId: true },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);

    // Undeploy MUST succeed before DB deletion — errors propagate to caller.
    await this.nodeDeploy.undeploy(id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Node ${id} undeploy failed, aborting deletion: ${msg}`);
      throw err;
    });

    // Clean up Cloudflare DNS record if present
    if (node.cfDnsRecordId && node.userId) {
      await this.cleanupCloudflareDns(node.userId, node.cfDnsRecordId);
    }

    return this.prisma.node.delete({ where: { id } });
  }

  /** Rename a node without triggering a redeploy */
  async rename(id: string, name: string) {
    const node = await this.prisma.node.findUnique({ where: { id } });
    if (!node) throw new NotFoundException(`Node ${id} not found`);
    return this.prisma.node.update({
      where: { id },
      data: { name },
      select: this.safeSelect(),
    });
  }

  /** Regenerate credentials and redeploy */
  async regenerateCredentials(id: string) {
    const node = await this.prisma.node.findUnique({
      where: { id },
      select: { id: true, protocol: true, tls: true },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);

    // Determine which preset generated this node by matching protocol+tls
    const { PROTOCOL_PRESETS: presets, CREDENTIAL_GENERATORS: generators } = await import('./protocols/presets');
    const presetKey = (Object.keys(presets) as (keyof typeof presets)[]).find(
      (k) => presets[k].protocol === node.protocol && presets[k].tls === node.tls,
    );

    let newCreds: Record<string, string>;
    if (presetKey) {
      newCreds = generators[presetKey]();
    } else {
      // Fallback: generate fresh UUID/password based on protocol
      newCreds = generateFallbackCredentials(node.protocol);
    }

    const credentialsEnc = this.crypto.encrypt(JSON.stringify(newCreds));
    await this.prisma.node.update({ where: { id }, data: { credentialsEnc } });

    this.nodeDeploy.deploy(id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Node ${id} redeploy after credential regeneration failed: ${msg}`);
    });

    return { ok: true };
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

  private async pickPort(serverId: string, fixedPort: number | null): Promise<number> {
    if (fixedPort !== null) return fixedPort;
    const usedPorts = new Set(
      (await this.prisma.node.findMany({ where: { serverId }, select: { listenPort: true } })).map(
        (n) => n.listenPort,
      ),
    );
    for (let i = 0; i < 100; i++) {
      const port = Math.floor(Math.random() * 40001) + 10000;
      if (!usedPorts.has(port)) return port;
    }
    throw new BadRequestException('No available port found on this server');
  }

  private async cleanupCloudflareDns(userId: string, recordId: string): Promise<void> {
    const settings = await this.cfSettings.getDecryptedToken(userId);
    if (!settings) return;
    try {
      await this.cfService.deleteRecord(settings.apiToken, settings.zoneId, recordId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Cloudflare DNS cleanup failed for record ${recordId}: ${msg}`);
      // Non-fatal — node is deleted regardless
    }
  }

  private async provisionCloudflareDns(userId: string, nodeId: string, serverId: string): Promise<void> {
    const settings = await this.cfSettings.getDecryptedToken(userId);
    if (!settings) return; // No CF configured — skip silently

    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: { ip: true },
    });
    if (!server) return;

    const subdomain = `np-${nodeId.slice(0, 8)}.${settings.domain}`;
    try {
      const recordId = await this.cfService.createARecord(
        settings.apiToken,
        settings.zoneId,
        subdomain,
        server.ip,
      );
      await this.prisma.node.update({
        where: { id: nodeId },
        data: { domain: subdomain, cfDnsRecordId: recordId },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Cloudflare DNS provision failed for node ${nodeId}: ${msg}`);
      // Non-fatal — node is created but without DNS record
    }
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
      source: true,
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
function generateFallbackCredentials(protocol: string): Record<string, string> {
  switch (protocol) {
    case 'VMESS':
    case 'VLESS':
      return { uuid: crypto.randomUUID() };
    case 'SHADOWSOCKS':
      return { password: crypto.randomBytes(32).toString('base64url').slice(0, 32), method: 'aes-256-gcm' };
    default:
      return { password: crypto.randomBytes(32).toString('base64url').slice(0, 32) };
  }
}

function generateRealityKeys(): { realityPrivateKey: string; realityPublicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const pubDer  = publicKey.export({ type: 'spki',  format: 'der' }) as Buffer;
  return {
    realityPrivateKey: privDer.slice(16).toString('base64url'),
    realityPublicKey:  pubDer.slice(12).toString('base64url'),
  };
}
