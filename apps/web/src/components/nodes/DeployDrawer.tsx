'use client';

import { useRef, useEffect } from 'react';
import { Drawer, Modal, Button, Space, Badge, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';
import type { DeployStatus } from '@/hooks/useDeployStream';
import { useIsMobile } from '@/hooks/useIsMobile';

const { Text } = Typography;

interface DeployDrawerProps {
  open: boolean;
  nodeName: string | null;
  logLines: string[];
  deployStatus: DeployStatus;
  onClose: () => void;
  actionLabel?: string;
}

export default function DeployDrawer({
  open,
  nodeName,
  logLines,
  deployStatus,
  onClose,
  actionLabel = '部署',
}: DeployDrawerProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const { isMobile } = useIsMobile();

  useEffect(() => {
    if (logLines.length > 0) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logLines]);

  const title = (
    <Space>
      <span>{actionLabel}日志 — {nodeName}</span>
      {deployStatus === 'running' && <Badge status="processing" text={`${actionLabel}中`} />}
      {deployStatus === 'success' && (
        <Text type="success">
          <CheckCircleFilled /> {actionLabel}成功
        </Text>
      )}
      {deployStatus === 'failed' && (
        <Text type="danger">
          <CloseCircleFilled /> {actionLabel}失败
        </Text>
      )}
    </Space>
  );

  const footer = deployStatus !== 'running'
    ? <Button type="primary" onClick={onClose}>关闭</Button>
    : null;

  const logContent = (
    <div
      style={{
        background: '#0d1117',
        color: '#c9d1d9',
        fontFamily: 'monospace',
        fontSize: 13,
        padding: 16,
        borderRadius: 6,
        minHeight: 200,
        lineHeight: 1.7,
      }}
    >
      {logLines.length === 0 && deployStatus === 'running' && (
        <span style={{ color: '#8b949e' }}>
          <LoadingOutlined style={{ marginRight: 8 }} />
          正在连接服务器...
        </span>
      )}
      {logLines.map((line, i) => (
        <div
          key={i}
          style={{
            color:
              line.includes('error') || line.includes('Error') || line.includes('失败')
                ? '#f85149'
                : '#c9d1d9',
          }}
        >
          {line}
        </div>
      ))}
      {deployStatus === 'success' && (
        <div style={{ color: '#3fb950', marginTop: 8 }}>✓ {actionLabel}完成</div>
      )}
      {deployStatus === 'failed' && (
        <div style={{ color: '#f85149', marginTop: 8 }}>✗ {actionLabel}失败，请检查以上日志</div>
      )}
      <div ref={logEndRef} />
    </div>
  );

  if (isMobile) {
    return (
      <Modal
        open={open}
        title={title}
        onCancel={onClose}
        footer={footer}
        width="100%"
        style={{ top: 0, maxWidth: '100vw', margin: 0, padding: 0 }}
        styles={{
          content: { borderRadius: 0, height: '100dvh', display: 'flex', flexDirection: 'column' },
          body: { flex: 1, overflowY: 'auto', padding: 12 },
        }}
        maskClosable={false}
      >
        {logContent}
      </Modal>
    );
  }

  return (
    <Drawer
      open={open}
      title={title}
      width={640}
      onClose={onClose}
      footer={footer}
    >
      <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
        {logContent}
      </div>
    </Drawer>
  );
}
