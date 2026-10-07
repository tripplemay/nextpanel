import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_METRIC_POINTS = 600;
export const METRIC_RANGES = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, '14d': 1209600 } as const;
export type MetricRange = keyof typeof METRIC_RANGES;

export class MetricsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_METRIC_POINTS)
  limit = 60;

  @IsOptional()
  @IsIn(Object.keys(METRIC_RANGES))
  range?: MetricRange;
}
