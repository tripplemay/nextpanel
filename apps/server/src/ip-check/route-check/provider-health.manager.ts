import { Logger } from '@nestjs/common';
import type { RouteProvider, InboundNode } from './route-provider.interface';

const FAIL_THRESHOLD = 3;          // mark provider as cooling after N consecutive failures
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

interface ProviderState {
  provider: RouteProvider;
  failCount: number;
  coolingUntil: number; // epoch ms, 0 = healthy
  lastSuccess: number;  // epoch ms
}

/**
 * Manages a priority-ordered list of RouteProviders with health-aware selection.
 *
 * On each call to checkInbound():
 *  1. Skip providers in cooldown.
 *  2. Try the first healthy provider.
 *  3. On success: reset failCount.
 *  4. On failure: increment failCount; enter cooldown if threshold exceeded.
 *  5. If all providers fail/cooling: return null.
 */
export class ProviderHealthManager {
  private readonly logger = new Logger(ProviderHealthManager.name);
  private readonly states: ProviderState[];

  constructor(providers: RouteProvider[]) {
    this.states = providers.map((p) => ({
      provider: p,
      failCount: 0,
      coolingUntil: 0,
      lastSuccess: 0,
    }));
  }

  async checkInbound(ip: string): Promise<InboundNode[] | null> {
    const now = Date.now();

    for (const state of this.states) {
      // Skip providers in cooldown
      if (state.coolingUntil > now) {
        const remaining = Math.ceil((state.coolingUntil - now) / 1000);
        this.logger.debug(`Provider ${state.provider.name} cooling, ${remaining}s left`);
        continue;
      }

      try {
        const result = await state.provider.checkInbound(ip);
        // Success: reset failure tracking
        state.failCount = 0;
        state.coolingUntil = 0;
        state.lastSuccess = Date.now();
        this.logger.debug(`Provider ${state.provider.name} succeeded for ${ip}`);
        return result;
      } catch (err) {
        state.failCount++;
        this.logger.warn(
          `Provider ${state.provider.name} failed for ${ip} (${state.failCount}/${FAIL_THRESHOLD}): ${err instanceof Error ? err.message : String(err)}`,
        );

        if (state.failCount >= FAIL_THRESHOLD) {
          state.coolingUntil = Date.now() + COOLDOWN_MS;
          this.logger.warn(
            `Provider ${state.provider.name} entering 5-min cooldown after ${FAIL_THRESHOLD} failures`,
          );
        }
        // Try next provider
      }
    }

    this.logger.warn(`All route providers failed or cooling for ${ip}, skipping inbound check`);
    return null;
  }

  /** For observability: returns provider health snapshot. */
  healthSnapshot() {
    const now = Date.now();
    return this.states.map((s) => ({
      name: s.provider.name,
      healthy: s.coolingUntil <= now,
      failCount: s.failCount,
      lastSuccess: s.lastSuccess ? new Date(s.lastSuccess).toISOString() : null,
    }));
  }
}
