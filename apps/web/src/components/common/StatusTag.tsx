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
  PENDING: 'gold',
  COMPLETED: 'green',
  FAILED: 'red',
};

const STATUS_LABEL: Record<string, string> = {
  RUNNING: '运行中',
  STOPPED: '已停止',
  ERROR: '异常',
  INACTIVE: '未部署',
  ONLINE: '在线',
  OFFLINE: '离线',
  DELETING: '删除中',
  UNKNOWN: '未知',
  PENDING: '排队中',
  COMPLETED: '已完成',
  FAILED: '失败',
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
