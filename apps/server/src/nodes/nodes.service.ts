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
import { CreateChainNodeDto } from './dto/create-chain-node.dto';
import { buildShareUri } from '../subscriptions/uri-builder';
import { PROTOCOL_PRESETS, CREDENTIAL_GENERATORS, type SupportedProtocol } from './protocols/presets';
import { withPostgresAdvisoryLocks } from '../common/database/advisory-lock';
import { parseSocksUri, SocksUriParseError, type ParsedSocksUri } from './socks-uri';

const CLOUDFLARE_PRESETS = new Set<SupportedProtocol>([
  'VLESS_WS_TLS',
  'VLESS_TCP_TLS',
  'TUIC_V5',
  'ANYTLS',
]);

const STRICT_DNS_PRESETS = new Set<SupportedProtocol>(['TUIC_V5', 'ANYTLS']);

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

  async create(dto: CreateNodeDto, userId: string) {
    await this.assertOwnedServer(dto.serverId, userId);
    const shape = normalizeNodeShape({
      protocol: dto.protocol,
      implementation: dto.implementation,
      transport: dto.transport,
      tls: dto.tls,
    });
    const egressIpPolicy = dto.egressIpPolicy ?? 'AUTO';
    assertEgressIpPolicySupported(shape, egressIpPolicy);
    assertRecommendedPort(shape, dto.listenPort);
    const requiresManagedDns = isManagedCertificateProtocol(shape.protocol);
    if (requiresManagedDns) await this.assertActiveCloudflare(userId);

    const creds = ensureCredentials(shape, { ...dto.credentials });
    const credentialsEnc = this.crypto.encrypt(JSON.stringify(creds));
    const node = await this.withDatabaseLocks([serverPortLock(dto.serverId)], async () => {
      await this.assertOwnedServer(dto.serverId, userId);
      await this.assertPortAvailable(dto.serverId, dto.listenPort, shape.implementation);
      return this.prisma.node.create({
        data: {
          serverId: dto.serverId,
          userId,
          name: dto.name,
          protocol: shape.protocol as any,
          implementation: shape.implementation as any,
          transport: shape.transport as any,
          tls: shape.tls as any,
          listenPort: dto.listenPort,
          domain: requiresManagedDns ? null : dto.domain,
          egressIpPolicy,
          credentialsEnc,
          enabled: dto.enabled ?? true,
          ...(requiresManagedDns ? { source: 'AUTO' as const } : {}),
        },
        select: this.safeSelect(),
      });
    });

    if (requiresManagedDns) {
      try {
        await this.provisionCloudflareDns(userId, node.id, dto.serverId, false, true);
      } catch (err) {
        await this.rollbackCreatedNode(node.id);
        throw err;
      }
    }

    // Deploy asynchronously — log errors instead of silently swallowing them
    this.nodeDeploy.deploy(node.id).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Node ${node.id} deploy failed: ${msg}`);
    });
    return requiresManagedDns ? this.findOne(node.id, userId) : node;
  }

  async createFromPreset(userId: string, dto: CreateNodeFromPresetDto) {
    await this.assertOwnedServer(dto.serverId, userId);
    const presetKey = dto.preset as SupportedProtocol;
    if (CLOUDFLARE_PRESETS.has(presetKey)) await this.assertActiveCloudflare(userId);

    const preset = PROTOCOL_PRESETS[presetKey];
    const credentials = CREDENTIAL_GENERATORS[presetKey]();
    const credentialsEnc = this.crypto.encrypt(JSON.stringify(credentials));
    const node = await this.withDatabaseLocks([serverPortLock(dto.serverId)], async () => {
      await this.assertOwnedServer(dto.serverId, userId);
      const listenPort = await this.pickPort(
        dto.serverId,
        preset.fixedPort,
        preset.portBase,
        preset.implementation,
      );
      return this.prisma.node.create({
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
    });

    // Auto-create Cloudflare DNS A records for CDN/TLS nodes. Modern TLS
    // protocols require DNS-only records and roll back creation on failure.
    if (CLOUDFLARE_PRESETS.has(presetKey)) {
      const strict = STRICT_DNS_PRESETS.has(presetKey);
      const proxied = presetKey === 'VLESS_WS_TLS';
      try {
        await this.provisionCloudflareDns(userId, node.id, dto.serverId, proxied, strict);
      } catch (err) {
        await this.rollbackCreatedNode(node.id);
        throw err;
      }
    }

    return this.findOne(node.id, userId);
  }

  async findAll(userId: string, serverId?: string) {
    return this.prisma.node.findMany({
      where: serverId ? { userId, serverId } : { userId },
      select: this.safeSelect(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const node = await this.prisma.node.findFirst({
      where: { id, userId },
      select: this.safeSelect(),
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);
    return node;
  }

  async update(id: string, dto: UpdateNodeDto, userId: string) {
    const lockTarget = await this.prisma.node.findFirst({
      where: { id, userId },
      select: { serverId: true },
    });
    if (!lockTarget) throw new NotFoundException(`Node ${id} not found`);

    return this.withDatabaseLocks([
      nodeOperationLock(id),
      serverPortLock(lockTarget.serverId),
    ], () =>
      this.updateExclusive(id, dto, userId),
    );
  }

  private async updateExclusive(id: string, dto: UpdateNodeDto, userId: string) {
    const existing = await this.prisma.node.findFirst({
      where: { id, userId },
      select: {
        name: true,
        serverId: true,
        protocol: true,
        implementation: true,
        transport: true,
        tls: true,
        listenPort: true,
        domain: true,
        egressIpPolicy: true,
        cfDnsRecordId: true,
        credentialsEnc: true,
        source: true,
        status: true,
        enabled: true,
      },
    });
    if (!existing) throw new NotFoundException(`Node ${id} not found`);
    if (dto.serverId !== undefined && dto.serverId !== existing.serverId) {
      throw new BadRequestException(
        '节点不支持在更新时更换服务器，请在目标服务器上创建新节点',
      );
    }

    const data: Record<string, unknown> = { ...dto };
    const enteringXhttp = dto.transport === 'XHTTP' && existing.transport !== 'XHTTP';
    const enteringManagedProtocol =
      dto.protocol !== undefined &&
      isManagedCertificateProtocol(dto.protocol) &&
      dto.protocol !== existing.protocol;
    const shape = normalizeNodeShape({
      protocol: dto.protocol ?? existing.protocol,
      implementation:
        dto.implementation ?? (enteringXhttp || enteringManagedProtocol ? undefined : existing.implementation),
      transport: dto.transport ?? (enteringManagedProtocol ? undefined : existing.transport),
      tls: dto.tls ?? (enteringXhttp || enteringManagedProtocol ? undefined : existing.tls),
    });
    const targetListenPort = dto.listenPort ?? existing.listenPort;
    const targetEgressIpPolicy = dto.egressIpPolicy ?? existing.egressIpPolicy;
    assertEgressIpPolicySupported(shape, targetEgressIpPolicy);
    assertRecommendedPort(shape, targetListenPort);
    await this.assertPortAvailable(
      existing.serverId,
      targetListenPort,
      shape.implementation,
      id,
    );
    const requiresManagedDns = isManagedCertificateProtocol(shape.protocol);
    const existingIsModern = isModernProtocolShape(existing);
    const targetIsModern = isModernProtocolShape(shape);
    const requiresTransactionalDeploy = existingIsModern || targetIsModern;
    const retiringProvisionedDns =
      !!existing.cfDnsRecordId &&
      !requiresManagedDns &&
      shape.tls !== 'TLS';
    if (requiresManagedDns) await this.assertActiveCloudflare(userId);

    data.protocol = shape.protocol;
    data.implementation = shape.implementation;
    data.transport = shape.transport;
    data.tls = shape.tls;
    if (requiresManagedDns) data.source = 'AUTO';

    if (needsCredentialNormalization(shape)) {
      const currentCreds = JSON.parse(
        this.crypto.decrypt(existing.credentialsEnc),
      ) as Record<string, string>;
      const merged = { ...currentCreds, ...(dto.credentials ?? {}) };
      data.credentialsEnc = this.crypto.encrypt(
        JSON.stringify(ensureCredentials(shape, merged)),
      );
      delete data.credentials;
    } else if (dto.credentials) {
      data.credentialsEnc = this.crypto.encrypt(
        JSON.stringify(dto.credentials),
      );
      delete data.credentials;
    }

    let pendingDns: { domain: string; recordId: string } | null = null;
    if (
      requiresManagedDns &&
      (enteringManagedProtocol || !existing.cfDnsRecordId || !existing.domain)
    ) {
      pendingDns = await this.createCloudflareDnsRecord(
        userId,
        id,
        dto.serverId ?? existing.serverId,
        false,
        !!existing.cfDnsRecordId,
      );
      data.domain = pendingDns.domain;
      data.cfDnsRecordId = pendingDns.recordId;
    } else if (requiresManagedDns) {
      // A managed certificate protocol must keep using its provisioned hostname.
      data.domain = existing.domain;
    } else if (retiringProvisionedDns) {
      data.domain = dto.domain ?? null;
      data.cfDnsRecordId = null;
    }

    let node;
    try {
      node = await this.prisma.node.update({
        where: { id },
        data,
        select: this.safeSelect(),
      });
    } catch (err) {
      if (pendingDns) await this.cleanupCloudflareDns(userId, pendingDns.recordId);
      throw err;
    }
    if (requiresTransactionalDeploy) {
      let deployFailure: string | null = null;
      let remoteRollbackFailed = false;
      try {
        const result = await this.nodeDeploy.deploy(
          id,
          undefined,
          undefined,
          undefined,
          {
            forceRollback: existingIsModern,
            skipAdvisoryLock: true,
            previousFirewall: {
              port: existing.listenPort,
              protocol: existing.protocol,
            },
          },
        );
        if (!result.success) {
          deployFailure = result.log || 'service did not become active';
          remoteRollbackFailed = result.rollbackFailed === true;
        }
      } catch (err) {
        deployFailure = err instanceof Error ? err.message : String(err);
        remoteRollbackFailed =
          typeof err === 'object' && err !== null &&
          (err as { rollbackFailed?: boolean }).rollbackFailed === true;
      }

      if (deployFailure) {
        if (remoteRollbackFailed) {
          throw new BadRequestException(
            `节点部署失败，且远程旧配置未能恢复；数据库与 DNS 保持当前状态，请根据部署日志人工处理：${deployFailure}`,
          );
        }
        try {
          await this.prisma.node.update({
            where: { id },
            data: {
              name: existing.name,
              serverId: existing.serverId,
              protocol: existing.protocol,
              implementation: existing.implementation,
              transport: existing.transport,
              tls: existing.tls,
              listenPort: existing.listenPort,
              domain: existing.domain,
              egressIpPolicy: existing.egressIpPolicy,
              cfDnsRecordId: existing.cfDnsRecordId,
              credentialsEnc: existing.credentialsEnc,
              source: existing.source,
              status: existing.status,
              enabled: existing.enabled,
            },
          });
        } catch (rollbackErr) {
          const rollbackMessage = rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr);
          this.logger.error(
            `Node ${id} deployment failed and database rollback also failed: ${rollbackMessage}`,
          );
          throw new Error(
            `节点部署失败，且数据库状态恢复失败：${rollbackMessage}. ` +
            `原始部署错误：${deployFailure}`,
          );
        }

        if (pendingDns) await this.cleanupCloudflareDns(userId, pendingDns.recordId);
        throw new BadRequestException(`节点部署失败，已恢复原配置：${deployFailure}`);
      }
    } else {
      // Preserve the historical asynchronous behavior for legacy-only edits.
      this.nodeDeploy.deploy(id, undefined, undefined, undefined, {
        previousFirewall: {
          port: existing.listenPort,
          protocol: existing.protocol,
        },
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Node ${id} redeploy failed: ${msg}`);
      });
    }

    // Retire the old DNS record only after the replacement service is healthy.
    if (retiringProvisionedDns && existing.cfDnsRecordId) {
      await this.cleanupCloudflareDns(userId, existing.cfDnsRecordId);
    } else if (
      pendingDns &&
      existing.cfDnsRecordId &&
      existing.cfDnsRecordId !== pendingDns.recordId
    ) {
      await this.cleanupCloudflareDns(userId, existing.cfDnsRecordId);
    }
    return node;
  }

  async remove(id: string, userId: string) {
    const lockTarget = await this.prisma.node.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!lockTarget) throw new NotFoundException(`Node ${id} not found`);

    return this.withDatabaseLocks([nodeOperationLock(id)], () =>
      this.removeExclusive(id, userId),
    );
  }

  private async removeExclusive(id: string, userId: string) {
    const node = await this.prisma.node.findFirst({
      where: { id, userId },
      select: { id: true, userId: true, cfDnsRecordId: true },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);

    // Undeploy MUST succeed before DB deletion — errors propagate to caller.
    await this.nodeDeploy.undeploy(id, { skipAdvisoryLock: true }).catch((err: unknown) => {
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
  async rename(id: string, name: string, userId: string) {
    const node = await this.prisma.node.findFirst({ where: { id, userId } });
    if (!node) throw new NotFoundException(`Node ${id} not found`);
    return this.prisma.node.update({
      where: { id },
      data: { name },
      select: this.safeSelect(),
    });
  }

  /** Toggle node enabled state: stop service if enabled, start if disabled */
  async toggle(id: string, userId: string) {
    const lockTarget = await this.prisma.node.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!lockTarget) throw new NotFoundException(`Node ${id} not found`);

    return this.withDatabaseLocks([nodeOperationLock(id)], () =>
      this.toggleExclusive(id, userId),
    );
  }

  private async toggleExclusive(id: string, userId: string) {
    const node = await this.prisma.node.findFirst({
      where: { id, userId },
      select: { id: true, enabled: true },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);

    const nowEnabled = !node.enabled;
    await this.nodeDeploy.toggleService(id, nowEnabled, { skipAdvisoryLock: true });

    return this.prisma.node.update({
      where: { id },
      data: {
        enabled: nowEnabled,
        status: nowEnabled ? 'RUNNING' : 'STOPPED',
      },
      select: this.safeSelect(),
    });
  }

  /** Build a single-node share URI (vmess://, vless://, etc.) */
  async getShareLink(id: string, userId: string): Promise<string | null> {
    const node = await this.prisma.node.findFirst({
      where: { id, userId },
      include: { server: { select: { ip: true } } },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);
    const credentials = await this.getCredentials(id, userId);
    return buildShareUri({
      name: node.name,
      protocol: node.protocol,
      host: node.tls === 'REALITY' ? node.server.ip : (node.domain ?? node.server.ip),
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
  async getCredentials(id: string, userId: string): Promise<Record<string, string>> {
    const node = await this.prisma.node.findFirst({
      where: { id, userId },
      select: { credentialsEnc: true },
    });
    if (!node) throw new NotFoundException(`Node ${id} not found`);
    return JSON.parse(this.crypto.decrypt(node.credentialsEnc)) as Record<string, string>;
  }

  async createChainNode(userId: string, dto: CreateChainNodeDto) {
    const exitType = dto.exitType ?? 'MANAGED_SERVER';
    const entryServer = await this.prisma.server.findFirst({ where: { id: dto.entryServerId, userId } });
    if (!entryServer) throw new NotFoundException('入口服务器不存在');
    if (!entryServer.sshAuthEnc) throw new BadRequestException('入口服务器凭证已销毁');

    let managedExitServerId: string | null = null;
    let parsedSocks: ParsedSocksUri | null = null;
    if (exitType === 'MANAGED_SERVER') {
      if (!dto.exitServerId || dto.socksUri !== undefined) {
        throw new BadRequestException('托管出口必须且只能提供出口服务器');
      }
      managedExitServerId = dto.exitServerId;
      const exitServer = await this.prisma.server.findFirst({
        where: { id: managedExitServerId, userId },
      });
      if (!exitServer) throw new NotFoundException('出口服务器不存在');
      if (!exitServer.sshAuthEnc) throw new BadRequestException('出口服务器凭证已销毁');
      if (dto.entryServerId === managedExitServerId) {
        throw new BadRequestException('入口和出口不能是同一台服务器');
      }
    } else {
      if (!dto.socksUri || dto.exitServerId !== undefined) {
        throw new BadRequestException('SOCKS5 出口必须且只能提供 SOCKS 地址');
      }
      try {
        parsedSocks = parseSocksUri(dto.socksUri);
      } catch (err) {
        if (err instanceof SocksUriParseError) throw new BadRequestException(err.message);
        throw err;
      }
    }

    const presetKey = dto.preset as SupportedProtocol;
    if (STRICT_DNS_PRESETS.has(presetKey)) await this.assertActiveCloudflare(userId);

    const preset = PROTOCOL_PRESETS[presetKey];
    const credentials = CREDENTIAL_GENERATORS[presetKey]();
    const credentialsEnc = this.crypto.encrypt(JSON.stringify(credentials));

    const chainCredEnc = managedExitServerId
      ? this.crypto.encrypt(JSON.stringify({
          uuid: crypto.randomUUID(),
          ...generateRealityKeys(),
          shortId: crypto.randomBytes(8).toString('hex'),
        }))
      : null;
    const socksExitEnc = parsedSocks
      ? this.crypto.encrypt(JSON.stringify(parsedSocks.config))
      : null;

    const lockKeys = [
      serverPortLock(dto.entryServerId),
      ...(managedExitServerId ? [serverPortLock(managedExitServerId)] : []),
    ];
    const node = await this.withDatabaseLocks(lockKeys, async () => {
      await this.assertOwnedServer(dto.entryServerId, userId);
      if (managedExitServerId) await this.assertOwnedServer(managedExitServerId, userId);
      const listenPort = await this.pickPort(
        dto.entryServerId,
        preset.fixedPort,
        preset.portBase,
        preset.implementation,
      );
      const exitPort = managedExitServerId
        ? await this.pickChainExitPort(managedExitServerId)
        : null;
      return this.prisma.node.create({
        data: {
          serverId: dto.entryServerId,
          userId,
          name: dto.name,
          protocol: preset.protocol as any,
          implementation: preset.implementation as any,
          transport: preset.transport as any,
          tls: preset.tls as any,
          listenPort,
          domain: null,
          credentialsEnc,
          exitType: exitType as any,
          exitServerId: managedExitServerId,
          exitPort,
          chainCredEnc,
          socksExitEnc,
          socksExitName: parsedSocks?.name ?? null,
          source: 'AUTO',
        },
        select: this.safeSelect(),
      });
    });

    if (STRICT_DNS_PRESETS.has(presetKey)) {
      try {
        await this.provisionCloudflareDns(userId, node.id, dto.entryServerId, false, true);
      } catch (err) {
        await this.rollbackCreatedNode(node.id);
        throw err;
      }
    }

    return this.findOne(node.id, userId);
  }

  // Port allocation for chain exit (15000-15999 range on exit server)
  private async pickChainExitPort(exitServerId: string): Promise<number> {
    const existingNodes = await this.prisma.node.findMany({
      where: { OR: [{ serverId: exitServerId }, { exitServerId }] },
      select: {
        serverId: true,
        listenPort: true,
        statsPort: true,
        implementation: true,
        exitServerId: true,
        exitPort: true,
      },
    });
    const usedPorts = collectServerPorts(existingNodes, exitServerId);
    for (let i = 0; i < 1000; i++) {
      const port = 15000 + i;
      if (!usedPorts.has(port)) return port;
    }
    throw new BadRequestException('出口服务器链式端口已用尽（15000-15999）');
  }

  private async pickPort(
    serverId: string,
    fixedPort: number | null,
    portBase: number | null,
    implementation: string | null,
  ): Promise<number> {
    if (fixedPort === null && portBase === null) {
      throw new BadRequestException('Preset misconfiguration: no fixedPort or portBase');
    }

    const existingNodes = await this.prisma.node.findMany({
      where: { OR: [{ serverId }, { exitServerId: serverId }] },
      select: {
        serverId: true,
        listenPort: true,
        statsPort: true,
        implementation: true,
        exitServerId: true,
        exitPort: true,
      },
    });

    // Reserve both listenPort and statsPort of every existing node so neither
    // the new listen port nor its derived stats port (listenPort+20000) collides.
    const usedPorts = collectServerPorts(existingNodes, serverId);

    if (fixedPort !== null) {
      const derivedStats = derivedStatsPort(fixedPort, implementation);
      const conflictingPort = usedPorts.has(fixedPort)
        ? fixedPort
        : derivedStats !== null && usedPorts.has(derivedStats)
          ? derivedStats
          : null;
      if (conflictingPort !== null) {
        throw new BadRequestException(
          `固定端口 ${fixedPort} 无法使用：服务器端口 ${conflictingPort} 已被其他节点占用`,
        );
      }
      return fixedPort;
    }
    if (portBase === null) {
      throw new BadRequestException('Preset misconfiguration: no fixedPort or portBase');
    }

    // Scan [portBase, portBase+999] in order — deterministic, no randomness.
    // Each preset has its own non-overlapping range so collisions between
    // different protocol types are structurally impossible.
    for (let i = 0; i < 1000; i++) {
      const port = portBase + i;
      const derivedStats = derivedStatsPort(port, implementation);
      if (!usedPorts.has(port) && (derivedStats === null || !usedPorts.has(derivedStats))) {
        return port;
      }
    }
    throw new BadRequestException(
      `Port range [${portBase}–${portBase + 999}] is exhausted on this server`,
    );
  }

  private async assertPortAvailable(
    serverId: string,
    listenPort: number,
    implementation: string | null,
    excludeNodeId?: string,
  ): Promise<void> {
    const existingNodes = await this.prisma.node.findMany({
      where: {
        OR: [{ serverId }, { exitServerId: serverId }],
        ...(excludeNodeId ? { id: { not: excludeNodeId } } : {}),
      },
      select: {
        id: true,
        serverId: true,
        listenPort: true,
        statsPort: true,
        implementation: true,
        exitServerId: true,
        exitPort: true,
      },
    });
    const candidatePorts = new Set<number>([listenPort]);
    const candidateStats = derivedStatsPort(listenPort, implementation);
    if (candidateStats !== null) candidatePorts.add(candidateStats);

    for (const node of existingNodes) {
      const occupied = [...collectServerPorts([node], serverId)];
      const conflict = occupied.find((port) => candidatePorts.has(port));
      if (conflict !== undefined) {
        throw new BadRequestException(
          `服务器端口 ${conflict} 已被节点 ${node.id} 占用，请选择其他端口`,
        );
      }
    }
  }

  private async withDatabaseLocks<T>(keys: string[], work: () => Promise<T>): Promise<T> {
    return withPostgresAdvisoryLocks(keys, work);
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

  private async assertActiveCloudflare(userId: string): Promise<void> {
    const cf = await this.cfSettings.verify(userId);
    if (!cf.valid) {
      throw new BadRequestException(`无法创建该节点：${cf.message}`);
    }
    if (cf.zoneStatus !== 'active') {
      throw new BadRequestException(
        `Cloudflare Zone 尚未生效（当前状态：${cf.zoneStatus ?? 'unknown'}），请等待 DNS 传播完成后重试`,
      );
    }
  }

  private async assertOwnedServer(serverId: string, userId: string): Promise<void> {
    const server = await this.prisma.server.findFirst({
      where: { id: serverId, userId },
      select: { id: true, status: true },
    });
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);
    if (server.status === 'DELETING') {
      throw new BadRequestException('服务器正在删除，不能创建新节点');
    }
  }

  private async createCloudflareDnsRecord(
    userId: string,
    nodeId: string,
    serverId: string,
    proxied: boolean,
    useTransitionHostname = false,
  ): Promise<{ domain: string; recordId: string }> {
    const settings = await this.cfSettings.getDecryptedToken(userId);
    if (!settings) {
      throw new BadRequestException('无法创建该节点：未配置 Cloudflare 设置');
    }

    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: { ip: true },
    });
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);

    const transitionSuffix = useTransitionHostname
      ? `-${crypto.randomBytes(3).toString('hex')}`
      : '';
    const domain = `np-${nodeId.slice(0, 8)}${transitionSuffix}.${settings.domain}`;
    const recordId = await this.cfService.createARecord(
      settings.apiToken,
      settings.zoneId,
      domain,
      server.ip,
      proxied,
    );
    return { domain, recordId };
  }

  private async rollbackCreatedNode(nodeId: string): Promise<void> {
    try {
      await this.prisma.node.delete({ where: { id: nodeId } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to roll back node ${nodeId}: ${msg}`);
    }
  }

  private async provisionCloudflareDns(
    userId: string,
    nodeId: string,
    serverId: string,
    proxied = true,
    strict = false,
  ): Promise<void> {
    let recordId: string | null = null;
    try {
      const record = await this.createCloudflareDnsRecord(userId, nodeId, serverId, proxied);
      recordId = record.recordId;
      await this.prisma.node.update({
        where: { id: nodeId },
        data: { domain: record.domain, cfDnsRecordId: record.recordId },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Cloudflare DNS provision failed for node ${nodeId}: ${msg}`);
      if (recordId) await this.cleanupCloudflareDns(userId, recordId);
      if (strict) throw err;
      // Existing TLS presets preserve their historical best-effort behavior.
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
      egressIpPolicy: true,
      source: true,
      status: true,
      enabled: true,
      statsPort: true,
      trafficUpBytes: true,
      trafficDownBytes: true,
      lastReachable: true,
      lastLatency: true,
      lastTestedAt: true,
      createdAt: true,
      updatedAt: true,
      exitServerId: true,
      exitPort: true,
      exitType: true,
      socksExitName: true,
      exitServer: { select: { id: true, name: true, ip: true } },
      server: { select: { id: true, name: true, ip: true, tags: true, autoTags: true } },
    } as const;
  }
}

interface NodeShape {
  protocol: string;
  implementation: string | null;
  transport: string | null;
  tls: string;
}

function normalizeNodeShape(input: {
  protocol: string;
  implementation?: string | null;
  transport?: string | null;
  tls?: string | null;
}): NodeShape {
  if (input.transport === 'QUIC') {
    throw new BadRequestException(
      'Xray 26.x 已移除 QUIC 传输，请迁移到 VLESS + XHTTP + REALITY 或 TUIC v5',
    );
  }

  let implementation = input.implementation ?? null;
  let transport = input.transport ?? null;
  let tls = input.tls ?? 'NONE';

  if (transport === 'XHTTP') {
    if (input.protocol !== 'VLESS') {
      throw new BadRequestException('XHTTP 传输仅支持 VLESS 协议');
    }
    if (implementation && implementation !== 'XRAY') {
      throw new BadRequestException('VLESS + XHTTP 仅支持 Xray 实现');
    }
    if (input.tls && input.tls !== 'REALITY') {
      throw new BadRequestException('VLESS + XHTTP 仅支持 REALITY 安全模式');
    }
    implementation = 'XRAY';
    tls = 'REALITY';
  }

  if (isManagedCertificateProtocol(input.protocol)) {
    if (implementation && implementation !== 'SING_BOX') {
      throw new BadRequestException(`${input.protocol} 仅支持 sing-box 实现`);
    }
    if (transport) {
      throw new BadRequestException(`${input.protocol} 使用原生传输，不支持额外传输层`);
    }
    if (input.tls && input.tls !== 'TLS') {
      throw new BadRequestException(`${input.protocol} 必须启用 TLS`);
    }
    implementation = 'SING_BOX';
    transport = null;
    tls = 'TLS';
  }

  if (tls === 'REALITY' && input.protocol !== 'VLESS') {
    throw new BadRequestException('REALITY 仅支持 VLESS 协议');
  }

  return { protocol: input.protocol, implementation, transport, tls };
}

function isManagedCertificateProtocol(protocol: string): boolean {
  return protocol === 'TUIC' || protocol === 'ANYTLS';
}

function assertRecommendedPort(shape: NodeShape, listenPort: number): void {
  if (shape.transport === 'XHTTP' && listenPort !== 443) {
    throw new BadRequestException('VLESS + XHTTP + REALITY 必须监听 443 端口');
  }
}

function assertEgressIpPolicySupported(
  shape: NodeShape,
  policy: string,
): void {
  const implementation = (shape.implementation ?? 'XRAY').toUpperCase();
  if (policy === 'IPV4_ONLY' && implementation !== 'XRAY') {
    throw new BadRequestException('仅 Xray 节点支持 IPv4-only 出口策略');
  }
}

function derivedStatsPort(listenPort: number, implementation: string | null): number | null {
  const impl = (implementation ?? 'XRAY').toUpperCase();
  if (impl !== 'XRAY' && impl !== 'V2RAY') return null;
  if (listenPort + 20000 <= 65535) return listenPort + 20000;
  if (listenPort - 20000 >= 1) return listenPort - 20000;
  return 40000 + (listenPort % 10000);
}

type ServerPortNode = {
  serverId: string;
  listenPort: number;
  statsPort: number | null;
  implementation: string | null;
  exitServerId: string | null;
  exitPort: number | null;
};

function collectServerPorts(nodes: ServerPortNode[], serverId: string): Set<number> {
  const ports = new Set<number>();
  for (const node of nodes) {
    if (node.serverId === serverId) {
      ports.add(node.listenPort);
      const statsPort = node.statsPort ?? derivedStatsPort(node.listenPort, node.implementation);
      if (statsPort !== null) ports.add(statsPort);
    }
    if (node.exitServerId === serverId && node.exitPort !== null) {
      ports.add(node.exitPort);
    }
  }
  return ports;
}

function serverPortLock(serverId: string): string {
  return `nextpanel:server-ports:${serverId}`;
}

function nodeOperationLock(nodeId: string): string {
  return `nextpanel:node:${nodeId}`;
}

function isModernProtocolShape(shape: { protocol: string; transport: string | null }): boolean {
  return shape.transport === 'XHTTP' || isManagedCertificateProtocol(shape.protocol);
}

function needsCredentialNormalization(shape: NodeShape): boolean {
  return (
    shape.tls === 'REALITY' ||
    shape.transport === 'XHTTP' ||
    isManagedCertificateProtocol(shape.protocol)
  );
}

function ensureCredentials(
  shape: NodeShape,
  credentials: Record<string, string | undefined>,
): Record<string, string> {
  const normalized = Object.fromEntries(
    Object.entries(credentials).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  if (shape.transport === 'XHTTP') {
    const generated = CREDENTIAL_GENERATORS.VLESS_XHTTP_REALITY();
    normalized.uuid ||= generated.uuid;
    if (!normalized.realityPrivateKey || !normalized.realityPublicKey) {
      const keys = generateRealityKeys();
      normalized.realityPrivateKey = keys.realityPrivateKey;
      normalized.realityPublicKey = keys.realityPublicKey;
    }
    normalized.shortId ||= generated.shortId;
    normalized.path ||= generated.path;

    if (!/^[0-9a-f]{16}$/i.test(normalized.shortId)) {
      throw new BadRequestException('XHTTP REALITY shortId 必须是 16 位十六进制字符串');
    }
    if (!normalized.path.startsWith('/')) {
      throw new BadRequestException('XHTTP path 必须以 / 开头');
    }
  } else if (shape.protocol === 'TUIC') {
    const generated = CREDENTIAL_GENERATORS.TUIC_V5();
    normalized.uuid ||= generated.uuid;
    normalized.password ||= generated.password;
  } else if (shape.protocol === 'ANYTLS') {
    normalized.password ||= CREDENTIAL_GENERATORS.ANYTLS().password;
  } else if (shape.tls === 'REALITY' && (!normalized.realityPrivateKey || !normalized.realityPublicKey)) {
    Object.assign(normalized, generateRealityKeys());
  }

  return normalized;
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
