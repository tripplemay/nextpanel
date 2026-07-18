import dayjs from '@/lib/dayjs';

/**
 * 语义状态色，与 AntD 默认 token 对齐（亮/暗主题下取值一致）。
 * 用于进度条、状态点、图表等 AntD 组件之外或需要自定义着色的场景。
 */
export const statusColors = {
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
  info: '#1677ff',
  neutral: '#8c8c8c',
} as const;

/** CPU/内存/磁盘使用率 → 颜色 */
export function usageColor(pct: number | null | undefined): string {
  if (pct == null) return statusColors.info;
  if (pct < 70) return statusColors.success;
  if (pct < 90) return statusColors.warning;
  return statusColors.error;
}

/** ping 延迟（ms）→ 颜色 */
export function pingColor(ms: number | null | undefined): string {
  if (ms == null) return statusColors.neutral;
  if (ms <= 50) return statusColors.success;
  if (ms <= 150) return statusColors.warning;
  return statusColors.error;
}

/** 最后心跳时间 → 颜色 */
export function heartbeatColor(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return statusColors.neutral;
  const diffMin = dayjs().diff(dayjs(lastSeenAt), 'minute');
  if (diffMin <= 5) return statusColors.success;
  if (diffMin <= 30) return statusColors.warning;
  return statusColors.error;
}
