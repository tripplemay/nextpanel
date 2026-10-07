import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { IpCheckService } from '../ip-check/ip-check.service';
import { performance } from 'node:perf_hooks';
import { NetworkRateTracker } from './network-rate';

export interface HeartbeatPayload {
  agentToken: string;
  agentVersion: string;
  architecture?: 'amd64' | 'arm64';
  cpu: number;
  mem: number;
  disk: number;
  networkIn: number;
  networkOut: number;
  nodeStatuses?: { nodeId: string; status: 'RUNNING' | 'STOPPED' | 'ERROR' }[];
  nodeTraffic?: { nodeId: string; upBytes: number; downBytes: number }[];
}

interface LatestVersionCache {
  version: string;
  tagName: string;
  releaseNotes: string;
  fetchedAt: number;
  digests?: Record<string, string>;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly networkRates = new NetworkRateTracker();
  /** Cache latest GitHub release for 1 hour */
  private latestVersionCache: LatestVersionCache | null = null;
  /** Tracks when each server's pendingAgentUpdate was first observed, for timeout purposes */
  private readonly pendingUpdateSince = new Map<string, number>();
  private readonly PENDING_UPDATE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  constructor(
    private prisma: PrismaService,
    private metricsService: MetricsService,
    private ipCheck: IpCheckService,
    private config: ConfigService,
  ) {}

  async getLatestVersion(): Promise<{ version: string; releaseNotes: string }> {
    const ONE_HOUR = 60 * 60 * 1000;
    if (this.latestVersionCache && Date.now() - this.latestVersionCache.fetchedAt < ONE_HOUR) {
      return this.latestVersionCache;
    }

    const repo = this.config.get<string>('GITHUB_REPO') ?? 'tripplemay/nextpanel-releases';
    try {
      // Step 1: get latest release tag
      const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'nextpanel-server' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!releaseRes.ok) throw new Error(`GitHub API returned ${releaseRes.status}`);
      const data = await releaseRes.json() as { tag_name: string; assets?: { name: string; digest?: string }[] };

      // Extract semver from tag like "agent/v1.4.0" or "v1.4.0"
      const match = data.tag_name.match(/(\d+\.\d+\.\d+)/);
      const version = match ? match[1] : data.tag_name;
      const tagName = data.tag_name;
      const digests = Object.fromEntries((data.assets ?? [])
        .filter((asset) => /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? ''))
        .map((asset) => [asset.name, asset.digest!.slice(7)]));

      // Step 2: fetch RELEASE_NOTES.md for Chinese release notes
      const notesRes = await fetch(
        `https://raw.githubusercontent.com/${repo}/main/RELEASE_NOTES.md`,
        { signal: AbortSignal.timeout(10_000) },
      );
      let releaseNotes = '';
      if (notesRes.ok) {
        const md = await notesRes.text();
        releaseNotes = this.parseReleaseNotes(md, version);
      }

      this.latestVersionCache = { version, tagName, releaseNotes, fetchedAt: Date.now(), digests };
      return { version, releaseNotes };
    } catch (err) {
      this.logger.warn(`Failed to fetch latest agent version: ${err}`);
      return this.latestVersionCache ?? { version: '', releaseNotes: '' };
    }
  }

  /** Extract the section for `version` from RELEASE_NOTES.md */
  private parseReleaseNotes(md: string, version: string): string {
    const escaped = version.replace(/\./g, '\\.');
    const sectionRe = new RegExp(`^##\\s+v?${escaped}\\b.*$`, 'm');
    const start = md.search(sectionRe);
    if (start === -1) return '';
    const afterHeading = md.slice(start).indexOf('\n') + 1;
    const rest = md.slice(start + afterHeading);
    const nextSection = rest.search(/^##\s/m);
    return (nextSection === -1 ? rest : rest.slice(0, nextSection)).trim();
  }

  async handleHeartbeat(payload: HeartbeatPayload) {
    const receivedAt = performance.now();
    const server = await this.prisma.server.findUnique({
      where: { agentToken: payload.agentToken },
    });

    if (!server) {
      throw new UnauthorizedException('Unknown agent token');
    }

    const { input: netInRate, output: netOutRate } = this.networkRates.sample(
      server.id, payload.networkIn, payload.networkOut, receivedAt,
    );

    const updateData: Record<string, unknown> = {
      agentVersion: payload.agentVersion,
      cpuUsage: payload.cpu,
      memUsage: payload.mem,
      diskUsage: payload.disk,
      networkIn: netInRate,
      networkOut: netOutRate,
      status: 'ONLINE',
      lastSeenAt: new Date(),
    };

    // Handle pending agent update.
    // Keep pendingAgentUpdate=true (and show "更新中..." in UI) until the agent actually reports
    // the new version — not just until the command is sent. This prevents the banner from
    // disappearing immediately after the first heartbeat while the agent is still downloading.
    // Safety valve: clear the flag after 15 minutes regardless of reason (GitHub unreachable,
    // agent too old to support self-update like v1.3.0, or download stuck) to unblock the UI.
    let updateCommand: { version: string; downloadUrl: string; sha256: string } | undefined;
    if (server.pendingAgentUpdate) {
      const now = Date.now();
      if (!this.pendingUpdateSince.has(server.id)) {
        this.pendingUpdateSince.set(server.id, now);
      }
      const elapsed = now - (this.pendingUpdateSince.get(server.id) ?? now);

      const { version } = await this.getLatestVersion();
      const tagName = this.latestVersionCache?.tagName;

      if (version && tagName) {
        if (payload.agentVersion === version) {
          // Agent has successfully updated to the target version — clear the flag.
          updateData.pendingAgentUpdate = false;
          this.pendingUpdateSince.delete(server.id);
        } else if (elapsed > this.PENDING_UPDATE_TIMEOUT_MS) {
          // Command has been delivered for 15+ min but agent hasn't updated.
          // The agent binary may be too old to support self-update (e.g. v1.3.0 which predates
          // this feature) — clear the flag to unblock the UI and let the user retry via SSH install.
          this.logger.warn(`Agent update for server ${server.id} timed out after 15 min without version change, clearing flag`);
          updateData.pendingAgentUpdate = false;
          this.pendingUpdateSince.delete(server.id);
        } else {
          // Agent hasn't updated yet — keep the flag set and re-deliver the command.
          // The agent guards against concurrent updates with selfUpdateRunning, so re-sending is safe.
          const repo = this.config.get<string>('GITHUB_REPO') ?? 'tripplemay/nextpanel-releases';
          const arch = payload.architecture;
          const asset = arch && ['amd64', 'arm64'].includes(arch) ? `agent-linux-${arch}` : '';
          const sha256 = this.latestVersionCache?.digests?.[asset];
          if (asset && sha256) {
            updateCommand = {
              version,
              downloadUrl: `https://github.com/${repo}/releases/download/${tagName}/${asset}`,
              sha256,
            };
          } else {
            this.logger.warn(`Agent update withheld for ${server.id}: architecture or release digest unavailable; reinstall via SSH`);
          }
        }
      } else if (elapsed > this.PENDING_UPDATE_TIMEOUT_MS) {
        // Can't fetch latest version (GitHub unreachable) and 15 min have elapsed — give up to unblock UI.
        this.logger.warn(`Agent update for server ${server.id} timed out after 15 min, clearing flag`);
        updateData.pendingAgentUpdate = false;
        this.pendingUpdateSince.delete(server.id);
      }
    } else {
      this.pendingUpdateSince.delete(server.id);
    }

    // Test the current DB state at write time, not the earlier heartbeat snapshot.
    const updated = await this.prisma.server.updateMany({
      where: { id: server.id, status: { notIn: ['DELETING', 'ERROR'] } }, data: updateData,
    });
    if (updated.count !== 1) return { ok: true, xrayNodes: [] };

    await this.metricsService.record(
      server.id,
      payload.cpu,
      payload.mem,
      payload.disk,
      netInRate,
      netOutRate,
    );

    if (payload.nodeStatuses) {
      for (const { nodeId, status } of payload.nodeStatuses) {
        // Update regular nodes on this server OR chain exit nodes hosted on this server
        await this.prisma.node.updateMany({
          where: {
            id: nodeId,
            OR: [{ serverId: server.id }, { exitServerId: server.id }],
          },
          data: { status },
        });
      }
    }

    if (payload.nodeTraffic) {
      for (const { nodeId, upBytes, downBytes } of payload.nodeTraffic) {
        await this.prisma.node.updateMany({
          where: { id: nodeId, serverId: server.id },
          data: { trafficUpBytes: upBytes, trafficDownBytes: downBytes },
        });
      }
    }

    // Return xray nodes with their stats ports so the agent can query traffic
    const xrayNodes = await this.prisma.node.findMany({
      where: { serverId: server.id, statsPort: { not: null }, status: 'RUNNING' },
      select: { id: true, statsPort: true },
    });

    // Return pending IP check task if any
    const ipCheckTask = await this.ipCheck.getPendingTask(payload.agentToken);

    return {
      ok: true,
      xrayNodes: xrayNodes.map((n) => ({ nodeId: n.id, statsPort: n.statsPort })),
      ...(ipCheckTask ? { ipCheckTask: { serverId: ipCheckTask.serverId } } : {}),
      ...(updateCommand ? { updateCommand } : {}),
    };
  }
}
