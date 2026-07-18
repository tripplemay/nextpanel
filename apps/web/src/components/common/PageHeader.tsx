'use client';

import { Button, Divider, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useThemeTokens } from '@/theme/ThemeContext';

const { Title } = Typography;

interface PageHeaderProps {
  title: string;
  addLabel?: string;
  onAdd?: () => void;
  extra?: ReactNode;
}

/** 页面标题栏：吸顶 + 毛玻璃背景，滚动时标题与操作始终可见 */
export default function PageHeader({ title, addLabel, onAdd, extra }: PageHeaderProps) {
  const { isMobile } = useIsMobile();
  const tokens = useThemeTokens();
  const pad = isMobile ? 12 : 24;

  return (
    <div
      style={{
        position: 'sticky',
        top: 64,
        zIndex: 90,
        margin: `-${pad}px -${pad}px 0`,
        padding: `12px ${pad}px 0`,
        background: tokens.headerBg,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Title level={isMobile ? 5 : 4} style={{ margin: 0 }}>
          {title}
        </Title>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {extra}
          {onAdd && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => onAdd()}>
              {addLabel ?? '新增'}
            </Button>
          )}
        </div>
      </div>
      <Divider style={{ margin: '12px 0 16px' }} />
    </div>
  );
}
