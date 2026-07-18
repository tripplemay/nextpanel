'use client';

import { Progress, Typography } from 'antd';
import { usageColor } from '@/theme/semantic';

interface UsageBarProps {
  label: string;
  percent: number | null | undefined;
  labelWidth?: number;
}

/** 资源使用率条（CPU/内存/磁盘），颜色按阈值分级 */
export default function UsageBar({ label, percent, labelWidth = 28 }: UsageBarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11, width: labelWidth, flexShrink: 0 }}>
        {label}
      </Typography.Text>
      <Progress
        percent={percent != null ? Math.round(percent) : 0}
        size="small"
        strokeColor={usageColor(percent)}
        style={{ flex: 1, margin: 0 }}
        format={(p) => (percent != null ? `${p}%` : '—')}
      />
    </div>
  );
}
