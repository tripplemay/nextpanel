import { Injectable, Logger } from '@nestjs/common';
import { ProviderHealthManager } from './provider-health.manager';
import { ItdogProvider } from './providers/itdog.provider';
import { ChinazProvider } from './providers/chinaz.provider';
import type { InboundNode } from './route-provider.interface';

// Types mirrored in apps/web/src/types/api.ts
export interface RouteHop {
  n: number;
  ip: string;
  asn?: string;
  org?: string;
  ms: number;
}

export interface OutboundNode {
  isp: string;
  city: string;
  ip: string;
  pingMs: number;
  tcpMs: number;
  loss: number;
  hops?: RouteHop[];
}

export interface RouteData {
  checkedAt: string;
  outbound: OutboundNode[];   // 回程: from agent (node → China)
  inbound?: InboundNode[];    // 去程: from panel via 3rd-party API (China → node)
}

@Injectable()
export class RouteCheckService {
  private readonly logger = new Logger(RouteCheckService.name);
  private readonly health = new ProviderHealthManager([
    new ItdogProvider(),
    new ChinazProvider(),
  ]);

  /**
   * Fetches 去程 (inbound) ping data: Chinese nodes → nodeIp.
   * Returns null if all providers are unavailable.
   *
   * TODO: itdog (api.itdog.cn/ping → 404) and chinaz (api.ping.chinaz.com → DNS fail)
   * are both broken. Inbound check is temporarily disabled until a working provider
   * is found. Remove the early-return below to re-enable.
   */
  async checkInbound(_nodeIp: string): Promise<InboundNode[] | null> {
    this.logger.debug('Inbound check disabled: no working providers (itdog/chinaz both down)');
    return null;
  }

  /** Merges agent-reported outbound data with panel-fetched inbound data. */
  mergeInbound(routeData: RouteData, inbound: InboundNode[] | null): RouteData {
    return { ...routeData, inbound: inbound ?? undefined };
  }

  /** Returns current provider health for diagnostics. */
  providerHealth() {
    return this.health.healthSnapshot();
  }
}
