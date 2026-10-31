import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { isIP } from 'net';
import type { Prisma, ResourceCleanup, Server } from '@prisma/client';
import type { NodeSSH } from 'node-ssh';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { withPostgresAdvisoryLocks } from '../common/database/advisory-lock';
import { connectSsh } from '../nodes/ssh/ssh.util';
import { generateChainExitConfig } from '../nodes/config/config-generator';
import { listManagedServices, quote, resourcePaths, unavailablePorts } from './remote-inventory';
import { boundConnection, remoteExec } from './remote-exec';

const HOST_FILE = '/etc/nextpanel/host-id';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class CleanupBlockedError extends Error {}

export interface CleanupPayload {
  port?: number;
  statsPort?: number;
  protocols?: ('tcp' | 'udp')[];
  entryIp?: string;
  cfRecordId?: string;
  cfZoneId?: string;
}

export function cleanupPayload(value: Prisma.JsonValue): CleanupPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CleanupBlockedError('Invalid cleanup payload');
  const p = value as CleanupPayload;
  for (const port of [p.port, p.statsPort]) {
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new CleanupBlockedError('Invalid cleanup port');
  }
  if (p.protocols && (!Array.isArray(p.protocols) || p.protocols.some(x => x !== 'tcp' && x !== 'udp'))) throw new CleanupBlockedError('Invalid cleanup protocols');
  if (p.entryIp && !isIP(p.entryIp)) throw new CleanupBlockedError('Invalid cleanup source IP');
  if (p.cfRecordId && !/^[a-zA-Z0-9_-]{1,128}$/.test(p.cfRecordId)) throw new CleanupBlockedError('Invalid DNS record ID');
  if (p.cfZoneId && !/^[a-zA-Z0-9_-]{1,128}$/.test(p.cfZoneId)) throw new CleanupBlockedError('Invalid DNS zone ID');
  return p;
}

export function hashConfig(config: string): string {
  return createHash('sha256').update(config).digest('hex');
}

export function resourceProtocols(protocol: string): ('tcp' | 'udp')[] {
  if (protocol === 'HYSTERIA2' || protocol === 'TUIC') return ['udp'];
  if (protocol === 'SHADOWSOCKS' || protocol === 'SOCKS5') return ['tcp', 'udp'];
  return ['tcp'];
}

@Injectable()
export class ResourceLifecycleService {
  private readonly heartbeatInventoryAt = new Map<string, number>();
  private readonly finalInventoryAt = new Map<string, number>();
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  async instanceId(): Promise<string> {
    const row = await this.prisma.panelIdentity.upsert({ where: { id: 'primary' }, update: {}, create: { id: 'primary' } });
    return row.instanceId;
  }

  async connect(server: Server): Promise<NodeSSH> {
    if (!server.sshAuthEnc) throw new CleanupBlockedError('SSH credentials are unavailable; restore credentials before retrying');
    return boundConnection(await connectSsh({ host: server.ip, port: server.sshPort, username: server.sshUser,
      authType: server.sshAuthType, auth: this.crypto.decrypt(server.sshAuthEnc), readyTimeout: 10000 }));
  }

  async remoteHost(ssh: NodeSSH, expected?: string | null): Promise<string | null> {
    const r = await remoteExec(ssh, `set -eu; test ! -L ${HOST_FILE}; if [ ! -e ${HOST_FILE} ]; then exit 3; fi; cat ${HOST_FILE}`);
    if (r.code === 3 && !expected) return null;
    const actual = r.stdout.trim();
    if (r.code !== 0 || !UUID.test(actual) || (expected && expected !== actual)) {
      throw new CleanupBlockedError('Remote host identity is missing or changed; refusing automatic changes');
    }
    return actual;
  }

  async ensureHostIdentity(ssh: NodeSSH, server: Pick<Server, 'id' | 'remoteHostId'>): Promise<string> {
    let id = await this.remoteHost(ssh, server.remoteHostId);
    if (!id) {
      const proposed = randomUUID();
      const r = await remoteExec(ssh, `set -eu; umask 077; mkdir -p /etc/nextpanel; ` +
        `(set -C; printf '%s\\n' ${quote(proposed)} > ${HOST_FILE}) 2>/dev/null || test -f ${HOST_FILE}`);
      if (r.code !== 0) throw new Error('Cannot establish remote host identity');
      id = await this.remoteHost(ssh);
    }
    if (!id) throw new Error('Remote identity was not established');
    if (!server.remoteHostId) {
      await this.prisma.server.updateMany({ where: { id: server.id, remoteHostId: null }, data: { remoteHostId: id } });
      const current = await this.prisma.server.findUniqueOrThrow({ where: { id: server.id }, select: { remoteHostId: true } });
      if (current.remoteHostId !== id) throw new CleanupBlockedError('Concurrent remote identity change');
      server.remoteHostId = id;
    }
    return id;
  }

  async unavailablePorts(serverId: string, ownNodeId?: string): Promise<Set<number>> {
    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    if (server.retiredAt || server.status === 'DELETING') throw new ConflictException('Server deletion is pending');
    const ssh = await this.connect(server);
    try {
      const hostId = await this.remoteHost(ssh, server.remoteHostId);
      const used = await unavailablePorts(ssh, ownNodeId ? resourcePaths(ownNodeId, 'ENTRY').service : undefined);
      const pending = await this.prisma.resourceCleanup.findMany({ where: {
        state: { not: 'DONE' }, OR: [{ serverId }, ...(hostId ? [{ remoteHostId: hostId }] : [])],
      }, select: { payload: true } });
      for (const row of pending) {
        const payload = cleanupPayload(row.payload);
        if (payload.port) used.add(payload.port);
        if (payload.statsPort) used.add(payload.statsPort);
      }
      await this.observeServices(server, await listManagedServices(ssh), true);
      return used;
    } finally { ssh.dispose(); }
  }

  async configHash(ssh: NodeSSH, path: string): Promise<string | null> {
    const r = await remoteExec(ssh, `set -eu; test ! -L ${quote(path)}; if [ ! -e ${quote(path)} ]; then exit 3; fi; sha256sum -- ${quote(path)}`);
    if (r.code === 3) return null;
    if (r.code !== 0 || !/^[a-f0-9]{64}\s/.test(r.stdout)) throw new CleanupBlockedError('Cannot verify remote config fingerprint');
    return r.stdout.slice(0, 64);
  }

  private async readManifest(ssh: NodeSSH, path: string): Promise<string | null> {
    const r = await remoteExec(ssh, `set -eu; test ! -L ${quote(path)}; if [ ! -e ${quote(path)} ]; then exit 3; fi; head -c 8193 -- ${quote(path)}`);
    if (r.code === 3) return null;
    if (r.code !== 0 || r.stdout.length > 8192) throw new CleanupBlockedError('Cannot verify resource ownership manifest');
    return r.stdout;
  }

  private matchesManifest(raw: string, expected: Record<string, string>): boolean {
    try {
      const parsed = JSON.parse(raw);
      return parsed.version === 1 && Object.entries(expected).every(([key, value]) => parsed[key] === value);
    } catch { return false; }
  }

  private async writeManifest(ssh: NodeSSH, path: string, content: string) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const directory = path.slice(0, path.lastIndexOf('/'));
    const result = await remoteExec(ssh, `set -eu; umask 077; mkdir -p -- ${quote(directory)}; ` +
      `test ! -L ${quote(directory)}; test ! -L ${quote(path)}; ` +
      `trap ${quote(`rm -f -- ${quote(temporary)}`)} EXIT; ` +
      `printf '%s' ${quote(Buffer.from(content).toString('base64'))} | base64 -d > ${quote(temporary)}; ` +
      `chmod 0600 -- ${quote(temporary)}; mv -f -- ${quote(temporary)} ${quote(path)}`);
    if (result.code !== 0) throw new Error('Cannot atomically update ownership manifest');
  }

  async registerDeployment(ssh: NodeSSH, server: Server, nodeId: string, role: 'ENTRY' | 'EXIT', config: string) {
    const paths = resourcePaths(nodeId, role);
    const hostId = await this.ensureHostIdentity(ssh, server);
    const expected = { panelInstanceId: await this.instanceId(), hostId, serverId: server.id, nodeId, role };
    const previous = await this.readManifest(ssh, paths.manifest);
    if (previous && !this.matchesManifest(previous, expected)) throw new CleanupBlockedError('Resource belongs to a different panel or host registration');
    const configHash = hashConfig(config);
    if (await this.configHash(ssh, paths.config) !== configHash) throw new Error('Deployed config differs from the approved config');
    await this.writeManifest(ssh, paths.manifest, JSON.stringify({ version: 1, ...expected, configHash }));
    return {
      rollback: async () => {
        if (previous !== null) await this.writeManifest(ssh, paths.manifest, previous);
        else {
          const r = await remoteExec(ssh, `rm -f -- ${quote(paths.manifest)}`);
          if (r.code !== 0) throw new Error('Cannot restore ownership manifest');
        }
      },
    };
  }

  async assertDeploymentOwner(ssh: NodeSSH, server: Server, nodeId: string, role: 'ENTRY' | 'EXIT') {
    const hostId = await this.ensureHostIdentity(ssh, server);
    const raw = await this.readManifest(ssh, resourcePaths(nodeId, role).manifest);
    if (raw && !this.matchesManifest(raw, { panelInstanceId: await this.instanceId(), hostId, serverId: server.id, nodeId, role })) {
      throw new CleanupBlockedError('Resource ownership does not match this deployment');
    }
  }

  async observeServices(server: Pick<Server, 'id' | 'userId'>, names: string[], complete = false) {
    if (!complete && (this.heartbeatInventoryAt.get(server.id) ?? 0) > Date.now() - 60000) return;
    const services = [...new Set(names)].filter(n => /^nextpanel-(?:chain-)?[a-zA-Z0-9_-]{1,100}$/.test(n) && n !== 'nextpanel-agent');
    const known = await this.prisma.node.findMany({ where: { OR: [{ serverId: server.id }, { exitServerId: server.id }] }, select: { id: true, serverId: true, exitServerId: true } });
    const pending = await this.prisma.resourceCleanup.findMany({ where: { serverId: server.id, state: { not: 'DONE' } }, select: { nodeId: true, role: true } });
    const expected = new Set([
      ...known.flatMap(n => [...(n.serverId === server.id ? [resourcePaths(n.id, 'ENTRY').service] : []), ...(n.exitServerId === server.id ? [resourcePaths(n.id, 'EXIT').service] : [])]),
      ...pending.filter(t => t.role === 'ENTRY' || t.role === 'EXIT').map(t => resourcePaths(t.nodeId, t.role as 'ENTRY' | 'EXIT').service),
    ]);
    const unknown = services.filter(name => !expected.has(name));
    for (const serviceName of unknown) {
      const nodeId = serviceName.replace(/^nextpanel-(?:chain-)?/, '');
      await this.prisma.resourceFinding.upsert({
        where: { serverId_serviceName_kind: { serverId: server.id, serviceName, kind: 'UNKNOWN_SERVICE' } },
        create: { ownerId: server.userId, serverId: server.id, serviceName, nodeId, kind: 'UNKNOWN_SERVICE', detail: 'Service has no desired node or pending cleanup task; ownership review required' },
        update: { lastSeenAt: new Date(), resolvedAt: null },
      });
    }
    // Heartbeats only report a subset; absence in a heartbeat must never imply deletion.
    if (complete) await this.prisma.resourceFinding.updateMany({ where: { serverId: server.id, kind: 'UNKNOWN_SERVICE', resolvedAt: null,
      serviceName: { notIn: unknown } }, data: { resolvedAt: new Date() } });
    if (this.heartbeatInventoryAt.size > 10000) this.heartbeatInventoryAt.clear();
    this.heartbeatInventoryAt.set(server.id, Date.now());
  }

  async scan(serverId: string, ownerId: string) {
    const server = await this.prisma.server.findFirst({ where: { id: serverId, userId: ownerId } });
    if (!server) throw new NotFoundException('Server not found');
    const ssh = await this.connect(server);
    try {
      await this.remoteHost(ssh, server.remoteHostId);
      await this.observeServices(server, await listManagedServices(ssh), true);
    } finally { ssh.dispose(); }
    return this.list(ownerId);
  }

  async list(ownerId: string) {
    const [tasks, findings, retirements] = await Promise.all([
      this.prisma.resourceCleanup.findMany({ where: { ownerId, state: { not: 'DONE' } }, orderBy: { createdAt: 'asc' }, take: 200,
        select: { id: true, serverId: true, serverName: true, nodeName: true, role: true, state: true, attempts: true, nextAttemptAt: true, lastError: true, createdAt: true } }),
      this.prisma.resourceFinding.findMany({ where: { ownerId, resolvedAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 200 }),
      this.prisma.server.findMany({ where: { userId: ownerId, status: 'DELETING', cleanupQueuedAt: { not: null } },
        select: { id: true, name: true, deleteError: true }, take: 200 }),
    ]);
    return { tasks, findings, retirements };
  }

  async retry(id: string, ownerId: string) {
    const result = await this.prisma.resourceCleanup.updateMany({ where: { id, ownerId, state: { in: ['PENDING', 'BLOCKED'] } },
      data: { state: 'PENDING', nextAttemptAt: new Date(), lastError: null } });
    if (!result.count) throw new NotFoundException('Retryable cleanup task not found');
    return { queued: true };
  }

  async queueServerDeletion(serverId: string, ownerId: string, force: boolean) {
    const graph = await this.prisma.node.findMany({ where: { OR: [{ serverId }, { exitServerId: serverId }] }, select: { id: true, serverId: true, exitServerId: true } });
    const serverIds = [...new Set([serverId, ...graph.flatMap(n => [n.serverId, n.exitServerId].filter((id): id is string => !!id))])];
    const keys = [...serverIds.flatMap(id => [`nextpanel:server-core:${id}`, `nextpanel:server-ports:${id}`]), ...graph.map(n => `nextpanel:node:${n.id}`)];
    return withPostgresAdvisoryLocks(keys, async () => {
      const server = await this.prisma.server.findFirst({ where: { id: serverId, userId: ownerId } });
      if (!server) throw new NotFoundException('Server not found');
      const nodes = await this.prisma.node.findMany({ where: { OR: [{ serverId }, { exitServerId: serverId }] },
        include: { server: true, exitServer: true, snapshots: { orderBy: { version: 'desc' }, take: 1 } } });
      if (nodes.some(n => !graph.some(g => g.id === n.id))) throw new ConflictException('Server resources changed; retry deletion');
      if (nodes.some(n => n.userId !== ownerId || n.server.userId !== ownerId || (n.exitServer && n.exitServer.userId !== ownerId))) {
        throw new ConflictException('Cross-owner deployment requires manual review');
      }
      const panelInstanceId = await this.instanceId();
      const cf = nodes.some(n => n.cfDnsRecordId) ? await this.prisma.cloudflareSetting.findUnique({
        where: { userId: ownerId }, select: { zoneId: true, domain: true },
      }) : null;
      const tasks: Prisma.ResourceCleanupCreateManyInput[] = [];
      for (const node of nodes) {
        const base = { ownerId, deletionServerId: serverId, nodeId: node.id, nodeName: node.name, panelInstanceId };
        const snapshot = node.snapshots[0];
        tasks.push({ ...base, serverId: node.serverId, serverName: node.server.name, role: 'ENTRY', remoteHostId: node.server.remoteHostId,
          expectedConfigHashEnc: snapshot ? this.crypto.encrypt(hashConfig(this.crypto.decrypt(snapshot.content))) : null,
          payload: { port: node.listenPort, protocols: resourceProtocols(node.protocol), ...(node.statsPort ? { statsPort: node.statsPort } : {}) } });
        if (node.exitServer) {
          let fingerprint: string | null = null;
          if (node.exitPort && node.chainCredEnc) {
            const decoded = this.crypto.decrypt(node.chainCredEnc);
            const chain = decoded.startsWith('{') ? JSON.parse(decoded) : { uuid: decoded };
            const exitConfig = generateChainExitConfig(node.id, node.exitPort, chain.uuid, node.server.ip,
              chain.realityPrivateKey && chain.shortId ? { privateKey: chain.realityPrivateKey, shortId: chain.shortId } : undefined, node.egressIpPolicy);
            fingerprint = this.crypto.encrypt(hashConfig(exitConfig));
          }
          // Incomplete legacy metadata must create a blocked target, never omit an exit.
          tasks.push({ ...base, serverId: node.exitServerId!, serverName: node.exitServer.name, role: 'EXIT', remoteHostId: node.exitServer.remoteHostId,
            expectedConfigHashEnc: fingerprint, payload: { ...(node.exitPort ? { port: node.exitPort } : {}), protocols: ['tcp'], entryIp: node.server.ip } });
        }
        if (node.cfDnsRecordId) tasks.push({ ...base, serverId: node.serverId, serverName: node.server.name, role: 'DNS', payload: {
          cfRecordId: node.cfDnsRecordId,
          ...(cf && node.domain?.toLowerCase().endsWith(`.${cf.domain.toLowerCase()}`) ? { cfZoneId: cf.zoneId } : {}),
        } });
      }
      await this.prisma.$transaction(async tx => {
        await tx.resourceCleanup.createMany({ data: tasks, skipDuplicates: true });
        // Tasks retain every cleanup target before cascade removes snapshots and subscription membership.
        await tx.node.deleteMany({ where: { id: { in: nodes.map(n => n.id) } } });
        await tx.server.update({ where: { id: serverId }, data: { status: 'DELETING', cleanupQueuedAt: new Date(), deleteError: null, ...(force ? { retiredAt: new Date() } : {}) } });
      });
      return { status: 'DELETING', cleanupPending: true, retired: force };
    });
  }

  async prepareCleanup(ssh: NodeSSH, server: Server, job: ResourceCleanup) {
    if (job.role !== 'ENTRY' && job.role !== 'EXIT') throw new CleanupBlockedError('Invalid remote cleanup role');
    const paths = resourcePaths(job.nodeId, job.role);
    let hostId = await this.remoteHost(ssh, job.remoteHostId ?? server.remoteHostId);
    // Do not store a plaintext config digest in DB: it can be a password oracle.
    const expectedConfigHash = job.expectedConfigHashEnc ? this.crypto.decrypt(job.expectedConfigHashEnc) : null;
    const configHash = await this.configHash(ssh, paths.config);
    const raw = await this.readManifest(ssh, paths.manifest);
    const unit = await ssh.execCommand(`systemctl show ${quote(paths.service)} -p FragmentPath --value`);
    if (unit.code !== 0 && unit.code !== 1) throw new CleanupBlockedError('Cannot inspect cleanup unit');
    const fragment = unit.stdout.trim();
    if (fragment && fragment !== paths.unit) throw new CleanupBlockedError('Unit path differs from the managed path');
    if (!raw && configHash && configHash !== expectedConfigHash) throw new CleanupBlockedError('Remote config changed or has no approved snapshot');
    if (!hostId) {
      // Legacy adoption requires a positive match, not just absence of a DB record.
      if (!configHash || configHash !== expectedConfigHash || fragment !== paths.unit) throw new CleanupBlockedError('Legacy host identity cannot be established from an approved deployment');
      hostId = await this.ensureHostIdentity(ssh, server);
    }
    const expected = { panelInstanceId: job.panelInstanceId, hostId, serverId: job.serverId, nodeId: job.nodeId, role: job.role };
    // A failed redeploy can leave a newer failure snapshot in DB while restoring the
    // prior manifest/config. The matching installed manifest identifies that generation.
    if (raw && !this.matchesManifest(raw, { ...expected, ...(configHash ? { configHash } : {}) })) {
      throw new CleanupBlockedError('Ownership mismatch or config changed; automatic cleanup refused');
    }
    if (fragment) {
      const command = await ssh.execCommand(`systemctl show ${quote(paths.service)} -p ExecStart --value`);
      if (command.code !== 0 || !command.stdout.includes(` ${paths.config} `) && !command.stdout.includes(` ${paths.config} ;`)) {
        throw new CleanupBlockedError('Unit executable does not reference the managed config');
      }
      if (!configHash) throw new CleanupBlockedError('Managed unit exists without a verifiable config');
    }
    if (!raw && configHash && !fragment) throw new CleanupBlockedError('Unattributed config requires manual ownership review');
    await this.prisma.resourceCleanup.update({ where: { id: job.id }, data: { remoteHostId: hostId } });
    return paths;
  }

  async finishRetiredServers() {
    const servers = await this.prisma.server.findMany({ where: { status: 'DELETING', cleanupQueuedAt: { not: null } }, select: { id: true, userId: true } });
    let scanBudget = 3;
    for (const server of servers) {
      await withPostgresAdvisoryLocks([`nextpanel:server-core:${server.id}`, `nextpanel:server-ports:${server.id}`], async () => {
        const pending = await this.prisma.resourceCleanup.count({ where: { state: { not: 'DONE' }, OR: [{ serverId: server.id }, { deletionServerId: server.id }] } });
        const nodes = await this.prisma.node.count({ where: { OR: [{ serverId: server.id }, { exitServerId: server.id }] } });
        if (pending || nodes || !scanBudget || (this.finalInventoryAt.get(server.id) ?? 0) > Date.now() - 300000) return;
        scanBudget--;
        this.finalInventoryAt.set(server.id, Date.now());
        try {
          // Never discard the last SSH credentials before a complete final inventory.
          await this.scan(server.id, server.userId);
          const findings = await this.prisma.resourceFinding.count({ where: { serverId: server.id, resolvedAt: null } });
          if (findings) throw new CleanupBlockedError('Unknown remote services require ownership review; host credentials retained');
          await this.prisma.server.deleteMany({ where: { id: server.id, status: 'DELETING', cleanupQueuedAt: { not: null } } });
          this.finalInventoryAt.delete(server.id);
        } catch (error) {
          await this.prisma.server.updateMany({ where: { id: server.id, status: 'DELETING' }, data: {
            deleteError: error instanceof Error ? error.message.slice(0, 500) : 'Final inventory failed; credentials retained',
          } });
        }
      });
    }
    if (this.finalInventoryAt.size > 10000) this.finalInventoryAt.clear();
  }
}
