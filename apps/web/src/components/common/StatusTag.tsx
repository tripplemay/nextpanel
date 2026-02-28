'use client';

import { Tag } from 'antd';

const STATUS_COLOR: Record<string, string> = {
  RUNNING: 'green',
  STOPPED: 'orange',
  ERROR: 'red',
  INACTIVE: 'default',
  ONLINE: 'green',
  OFFLINE: 'red',
  UNKNOWN: 'default',
};

interface StatusTagProps {
  status: string;
  /** When false, overrides the status text with a disabled label */
  enabled?: boolean;
  disabledLabel?: string;
}

export default function StatusTag({
  status,
  enabled = true,
  disabledLabel = '已禁用',
}: StatusTagProps) {
  const color = STATUS_COLOR[status] ?? 'default';
  return (
    <Tag color={color}>
      {enabled ? status : disabledLabel}
    </Tag>
  );
}
