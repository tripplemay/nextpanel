'use client';

import { Tag } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

const STATUS_COLOR: Record<string, string> = {
  RUNNING: 'green',
  STOPPED: 'orange',
  ERROR: 'red',
  INACTIVE: 'default',
  ONLINE: 'green',
  OFFLINE: 'red',
  DELETING: 'processing',
  UNKNOWN: 'default',
};

const STATUS_LABEL: Record<string, string> = {
  DELETING: '删除中',
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
  const label = enabled ? (STATUS_LABEL[status] ?? status) : disabledLabel;
  return (
    <Tag color={color} icon={status === 'DELETING' ? <LoadingOutlined /> : undefined}>
      {label}
    </Tag>
  );
}
