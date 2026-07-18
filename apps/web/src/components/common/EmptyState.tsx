'use client';

import { Button, Empty, Typography } from 'antd';

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** 统一空状态：标题 + 描述 + 引导操作按钮 */
export default function EmptyState({ title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      style={{ padding: '48px 0' }}
      description={
        <div>
          <Typography.Text strong style={{ fontSize: 15, display: 'block' }}>
            {title}
          </Typography.Text>
          {description && (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {description}
            </Typography.Text>
          )}
        </div>
      }
    >
      {onAction && actionLabel && (
        <Button type="primary" onClick={onAction} style={{ marginTop: 8 }}>
          {actionLabel}
        </Button>
      )}
    </Empty>
  );
}
