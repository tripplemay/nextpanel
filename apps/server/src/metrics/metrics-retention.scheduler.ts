import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MetricsService } from './metrics.service';

const DEFAULT_RETENTION_DAYS = 14;

/**
 * Deletes ServerMetric time-series rows past the retention window so the table
 * stops growing without bound. Retention window is configurable via the
 * METRIC_RETENTION_DAYS env var (defaults to 14 days).
 */
@Injectable()
export class MetricsRetentionScheduler {
  private readonly logger = new Logger(MetricsRetentionScheduler.name);
  private running = false;

  constructor(private readonly metrics: MetricsService) {}

  private resolveRetentionDays(): number {
    const raw = process.env.METRIC_RETENTION_DAYS;
    if (!raw) return DEFAULT_RETENTION_DAYS;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      this.logger.warn(
        `Invalid METRIC_RETENTION_DAYS="${raw}", falling back to ${DEFAULT_RETENTION_DAYS} days`,
      );
      return DEFAULT_RETENTION_DAYS;
    }
    return Math.floor(n);
  }

  /** Daily at 04:00 — prune ServerMetric rows older than the retention window. */
  @Cron('0 4 * * *')
  async prune(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous metric prune still running, skipping this cycle');
      return;
    }
    this.running = true;
    const days = this.resolveRetentionDays();
    try {
      const deleted = await this.metrics.pruneOldMetrics(days);
      this.logger.log(
        `Metric retention: deleted ${deleted} ServerMetric rows older than ${days} days`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Metric retention prune failed: ${msg}`);
    } finally {
      this.running = false;
    }
  }
}
