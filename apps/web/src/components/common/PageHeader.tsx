'use client';

import { Button, Divider, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

const { Title } = Typography;

interface PageHeaderProps {
  title: string;
  addLabel?: string;
  onAdd?: () => void;
  extra?: ReactNode;
}

export default function PageHeader({ title, addLabel, onAdd, extra }: PageHeaderProps) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>{title}</Title>
        <div style={{ display: 'flex', gap: 8 }}>
          {extra}
          {onAdd && (
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
              {addLabel ?? '新增'}
            </Button>
          )}
        </div>
      </div>
      <Divider style={{ margin: '12px 0 16px' }} />
    </>
  );
}
