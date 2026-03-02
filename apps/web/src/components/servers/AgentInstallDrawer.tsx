'use client';

import { useEffect, useState } from 'react';
import { Drawer, Button, Space, Badge, Typography, Alert } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useDeployStream } from '@/hooks/useDeployStream';
import CopyButton from '@/components/common/CopyButton';

const { Text } = Typography;

interface Props {
  open: boolean;
  serverId: string;
  serverName: string;
  onClose: () => void;
}

export default function AgentInstallDrawer({
  open,
  serverId,
  serverName,
  onClose,
}: Props) {
  const { logLines, deployStatus, startStream, reset } = useDeployStream();
  const [manualCmd, setManualCmd] = useState('');

  const start = () => {
    void startStream(
      `/api/servers/${serverId}/install-agent`,
      undefined,
      (json) => {
        if (typeof json.manualCmd === 'string') setManualCmd(json.manualCmd);
      },
    );
  };

  useEffect(() => {
    if (open) {
      reset();
      setManualCmd('');
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serverId]);

  const drawerTitle = (
    <Space>
      <span>安装 Agent — {serverName}</span>
      {deployStatus === 'running' && <Badge status="processing" text="安装中" />}
      {deployStatus === 'success' && (
        <Text type="success"><CheckCircleFilled /> 安装成功</Text>
      )}
      {deployStatus === 'failed' && (
        <Text type="danger"><CloseCircleFilled /> 安装失败</Text>
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
          maxHeight: 'calc(100vh - 320px)',
          overflowY: 'auto',
          lineHeight: 1.7,
          marginBottom: 16,
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
                line.includes('错误') || line.includes('失败') || line.includes('Error')
                  ? '#f85149'
                  : line.includes('成功') || line.includes('完成')
                  ? '#3fb950'
                  : '#c9d1d9',
            }}
          >
            {line}
          </div>
        ))}
        {deployStatus === 'success' && (
          <div style={{ color: '#3fb950', marginTop: 8 }}>✓ Agent 安装完成</div>
        )}
        {deployStatus === 'failed' && (
          <div style={{ color: '#f85149', marginTop: 8 }}>✗ 安装失败，请查看上方日志或手动安装</div>
        )}
      </div>

      {deployStatus === 'failed' && (
        <Alert
          type="warning"
          message="手动安装命令"
          description={
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                如自动安装持续失败，可 SSH 到目标服务器手动执行：
              </Text>
              <Space.Compact style={{ width: '100%' }}>
                <Text
                  code
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: 11,
                    wordBreak: 'break-all',
                    display: 'block',
                  }}
                >
                  {manualCmd}
                </Text>
                <CopyButton text={manualCmd} />
              </Space.Compact>
            </Space>
          }
        />
      )}
    </Drawer>
  );
}
