'use client';

import { useEffect } from 'react';
import { Drawer, Button, Space, Badge, Typography } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useDeployStream } from '@/hooks/useDeployStream';

const { Text } = Typography;

interface Props {
  open: boolean;
  serverId: string;
  serverName: string;
  templateIds: string[];
  onClose: () => void;
}

export default function AutoSetupDrawer({
  open,
  serverId,
  serverName,
  templateIds,
  onClose,
}: Props) {
  const { logLines, deployStatus, startStream, reset } = useDeployStream();

  const start = () => {
    const query = templateIds.length > 0 ? `?templateIds=${templateIds.join(',')}` : '';
    void startStream(`/api/servers/${serverId}/auto-setup${query}`);
  };

  useEffect(() => {
    if (open) {
      reset();
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serverId]);

  const drawerTitle = (
    <Space>
      <span>自动配置 — {serverName}</span>
      {deployStatus === 'running' && <Badge status="processing" text="配置中" />}
      {deployStatus === 'success' && (
        <Text type="success"><CheckCircleFilled /> 配置完成</Text>
      )}
      {deployStatus === 'failed' && (
        <Text type="danger"><CloseCircleFilled /> 配置失败</Text>
      )}
    </Space>
  );

  return (
    <Drawer
      open={open}
      title={drawerTitle}
      width={640}
      onClose={onClose}
      footer={
        deployStatus !== 'running' && (
          <Space>
            {deployStatus === 'failed' && (
              <Button icon={<ReloadOutlined />} onClick={start}>重试</Button>
            )}
            <Button type="primary" onClick={onClose}>关闭</Button>
          </Space>
        )
      }
    >
      <div
        style={{
          background: '#0d1117',
          color: '#c9d1d9',
          fontFamily: 'monospace',
          fontSize: 13,
          padding: 16,
          borderRadius: 6,
          minHeight: 300,
          maxHeight: 'calc(100vh - 280px)',
          overflowY: 'auto',
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
                line.includes('ERROR') || line.includes('失败') || line.includes('error')
                  ? '#f85149'
                  : line.includes('成功') || line.includes('完成') || line.includes('===')
                  ? '#3fb950'
                  : line.includes('---')
                  ? '#e3b341'
                  : '#c9d1d9',
            }}
          >
            {line}
          </div>
        ))}
        {deployStatus === 'success' && (
          <div style={{ color: '#3fb950', marginTop: 8 }}>✓ 自动配置完成，节点已部署</div>
        )}
        {deployStatus === 'failed' && (
          <div style={{ color: '#f85149', marginTop: 8 }}>✗ 配置失败，请查看上方日志</div>
        )}
      </div>
    </Drawer>
  );
}
