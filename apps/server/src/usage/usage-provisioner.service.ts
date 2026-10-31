import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { withPostgresAdvisoryLocks } from '../common/database/advisory-lock';
import { ResourceLifecycleService } from '../resources/resource-lifecycle.service';
import { quote, resourcePaths } from '../resources/remote-inventory';
import { remoteExec } from '../resources/remote-exec';
import { uploadText } from '../nodes/ssh/ssh.util';
import { UsageService } from './usage.service';
import { runtimeUsers, usageConfig } from './usage-config';
import { LEGACY_EMAIL, usageEligible, usageEmail } from './usage.util';

@Injectable()
export class UsageProvisioner {
  private busy = false;
  private logger = new Logger(UsageProvisioner.name);
  constructor(private prisma: PrismaService, private crypto: CryptoService, private resources: ResourceLifecycleService, private usage: UsageService) {}

  @Cron('15 * * * * *')
  async tick() {
    if (!this.usage.enabled() || this.busy) return;
    this.busy = true;
    try {
      const nodes = await this.prisma.usageNode.findMany({ where: { preparedAt: { not: null }, node: { enabled: true, status: 'RUNNING', protocol: 'VLESS', transport: 'WS', tls: 'TLS', statsPort: { not: null }, server: { retiredAt: null, status: 'ONLINE' } } },
        orderBy: { syncedAt: 'asc' }, take: 5, include: { node: { select: { userId: true } } } });
      for (const n of nodes) await this.sync(n.nodeId, n.node.userId, false).catch(() => undefined);
      await this.prisma.usageBucket.deleteMany({ where: { timestamp: { lt: new Date(Date.now() - 30 * 86400_000) } } });
      await this.prisma.usageCredential.deleteMany({ where: { removedAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
    } finally { this.busy = false; }
  }

  async sync(nodeId: string, ownerId: string, allowRestart: boolean) {
    if (!this.usage.enabled()) throw new ServiceUnavailableException('Usage observation is disabled');
    const target = await this.prisma.node.findFirst({ where: { id: nodeId, userId: ownerId } });
    if (!target) throw new NotFoundException();
    return withPostgresAdvisoryLocks([`nextpanel:server-core:${target.serverId}`, `nextpanel:node:${nodeId}`, `nextpanel:usage:${nodeId}`], async () => {
      const node = await this.prisma.node.findFirst({ where: { id: nodeId, userId: ownerId }, include: { server: true, usageState: true } });
      if (!node || !usageEligible(node) || !node.statsPort || !node.enabled || node.status !== 'RUNNING'
        || node.server.retiredAt || ['DELETING', 'ERROR'].includes(node.server.status)) throw new BadRequestException('Node is not eligible for observation');
      if (!node.usageState) {
        const observed = await this.prisma.subscription.count({ where: { ownerId, usageEnabled: true, nodes: { some: { nodeId } },
          OR: [{ cfOnly: true }, { cfProtectedNodeIds: { has: nodeId } }] } });
        if (!observed) throw new BadRequestException('Node is not in an observed subscription');
        await this.prisma.usageNode.upsert({ where: { nodeId }, create: { nodeId }, update: {} });
      }
      await this.usage.revokeInvalidGrants(nodeId);
      const credentials = await this.prisma.usageCredential.findMany({ where: { nodeId, removedAt: null } });
      const users = credentials.filter(c => !c.revokedAt).map(c => ({ email: usageEmail(c.id), id: this.crypto.decrypt(c.uuidEnc) }));
      const paths = resourcePaths(nodeId, 'ENTRY');
      const stage = `${paths.config}.usage-${randomUUID()}`;
      const backup = `${stage}.backup`;
      const additions = `${stage}.add`;
      let ssh: Awaited<ReturnType<ResourceLifecycleService['connect']>> | undefined;
      let activated = false; let restart = false; let before = '';
      let ownership: { rollback: () => Promise<void> } | undefined;
      try {
        ssh = await this.resources.connect(node.server);
        const hash = await this.resources.assertUnchangedDeployment(ssh, node.server, nodeId);
        const read = await remoteExec(ssh, `head -c 1048577 -- ${quote(paths.config)}`);
        if (read.code !== 0 || read.stdout.length > 1048576 || createHash('sha256').update(read.stdout).digest('hex') !== hash) throw new Error('CONFIG_DRIFT');
        before = read.stdout;
        const next = usageConfig(before, nodeId, node.statsPort, users);
        const legacyId = JSON.parse(next.config).inbounds.find((i: { tag: string }) => i.tag === `in-${nodeId}`).settings.clients[0].id;
        restart = !next.prepared;
        if (restart && !allowRestart) throw new Error('PREPARATION_REQUIRED');
        const api = `/usr/local/bin/xray api`;
        const address = `--server=127.0.0.1:${node.statsPort}`;
        const tag = `-tag=${quote(`in-${nodeId}`)}`;
        const readUsers = async () => {
          const result = await remoteExec(ssh!, `${api} inbounduser ${address} ${tag}`);
          if (result.code !== 0) throw new Error('UNSUPPORTED_API');
          return runtimeUsers(result.stdout);
        };
        let current = restart ? new Map<string, string>() : await readUsers();
        for (const u of users) if (current.has(u.email) && current.get(u.email) !== u.id) throw new Error('RUNTIME_IDENTITY_CONFLICT');
        if (next.config !== before) {
          await uploadText(ssh, next.config, stage);
          const check = await remoteExec(ssh, `/usr/local/bin/xray run -test -config ${quote(stage)} >/dev/null 2>&1`);
          if (check.code !== 0) throw new Error('CONFIG_VALIDATION_FAILED');
          const activate = await remoteExec(ssh, `set -eu; test ! -L ${quote(paths.config)}; ` +
            `test "$(sha256sum -- ${quote(paths.config)} | cut -d ' ' -f 1)" = ${quote(hash)}; ` +
            `cp -p -- ${quote(paths.config)} ${quote(backup)}; mv -f -- ${quote(stage)} ${quote(paths.config)}`);
          if (activate.code !== 0) throw new Error('CONFIG_ACTIVATION_FAILED');
          activated = true;
          ownership = await this.resources.registerDeployment(ssh, node.server, nodeId, 'ENTRY', next.config);
        }
        if (restart) {
          const result = await remoteExec(ssh, `systemctl restart ${quote(paths.service)}`, 30000);
          if (result.code !== 0) throw new Error('RESTART_FAILED');
          for (let attempt = 0; attempt < 5; attempt++) {
            try { current = await readUsers(); break; }
            catch (e) { if (attempt === 4) throw e; await new Promise(r => setTimeout(r, 500)); }
          }
        } else {
          const missing = users.filter(u => !current.has(u.email));
          if (missing.length) {
            await uploadText(ssh, JSON.stringify({ inbounds: [{ tag: `in-${nodeId}`, listen: '127.0.0.1', port: node.listenPort, protocol: 'vless', settings: { clients: missing.map(u => ({ ...u, level: 4242 })), decryption: 'none' } }] }), additions);
            const add = await remoteExec(ssh, `${api} adu ${address} ${quote(additions)} >/dev/null 2>&1`);
            if (add.code !== 0) throw new Error('SYNC_FAILED');
          }
          const expected = new Set(users.map(u => u.email));
          const removed = [...current.keys()].filter(email => /^np-usage-[a-z0-9]+$/.test(email) && !expected.has(email));
          if (removed.length) {
            const remove = await remoteExec(ssh, `${api} rmu ${address} ${tag} ${removed.map(quote).join(' ')} >/dev/null 2>&1`);
            if (remove.code !== 0) throw new Error('REVOCATION_PENDING');
          }
        }
        const verified = await readUsers();
        if (verified.get(LEGACY_EMAIL) !== legacyId || users.some(u => verified.get(u.email) !== u.id)
          || credentials.some(c => c.revokedAt && verified.has(usageEmail(c.id)))) throw new Error('VERIFICATION_FAILED');
        const at = new Date();
        const encrypted = this.crypto.encrypt(next.config);
        await this.prisma.$transaction(async tx => {
          if (activated) {
            const last = await tx.configSnapshot.findFirst({ where: { nodeId }, orderBy: { version: 'desc' }, select: { version: true } });
            await tx.configSnapshot.create({ data: { nodeId, version: (last?.version ?? 0) + 1, content: encrypted,
              checksum: createHash('sha256').update(encrypted).digest('hex'), deployLog: 'Usage credentials reconciled; credentials omitted.' } });
          }
          await tx.usageCredential.updateMany({ where: { id: { in: credentials.filter(c => !c.revokedAt).map(c => c.id) } }, data: { installedAt: at } });
          await tx.usageCredential.updateMany({ where: { id: { in: credentials.filter(c => !!c.revokedAt).map(c => c.id) } }, data: { removedAt: at } });
          await tx.usageNode.update({ where: { nodeId }, data: { preparedAt: at, syncedAt: at, error: null } });
        });
        return { nodeId, prepared: true, installed: users.length, restarted: restart };
      } catch (error) {
        const reason = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'SYNC_FAILED';
        if (ssh && activated && (restart || !ownership)) {
          try {
            await uploadText(ssh, before, stage);
            const restore = await remoteExec(ssh, `mv -f -- ${quote(stage)} ${quote(paths.config)}` +
              (restart ? ` && systemctl restart ${quote(paths.service)} && systemctl is-active --quiet ${quote(paths.service)}` : ''), 30000);
            if (restore.code !== 0) throw new Error('rollback');
            await ownership?.rollback();
          } catch { await this.prisma.usageNode.update({ where: { nodeId }, data: { error: 'ROLLBACK_FAILED', preparedAt: null, syncedAt: new Date() } }); throw new ServiceUnavailableException('Usage preparation failed; rollback needs operator review'); }
        }
        await this.prisma.usageNode.update({ where: { nodeId }, data: { error: reason, syncedAt: new Date(), ...(reason === 'PREPARATION_REQUIRED' ? { preparedAt: null } : {}) } });
        this.logger.warn(`Usage synchronization failed for ${nodeId}: ${reason}`);
        throw new ServiceUnavailableException(reason);
      } finally {
        if (ssh) {
          await remoteExec(ssh, `rm -f -- ${quote(stage)} ${quote(additions)}`).catch(() => undefined);
          // Keep the bounded pre-change backup on failures; never log its credential contents.
          if (!restart || !activated) await remoteExec(ssh, `rm -f -- ${quote(backup)}`).catch(() => undefined);
          ssh.dispose();
        }
      }
    });
  }
}
