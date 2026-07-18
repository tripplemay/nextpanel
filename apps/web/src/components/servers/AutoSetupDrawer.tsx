'use client';

import { useEffect } from 'react';
import { Drawer, Button, Space, Badge, Typography } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ReloadOutlined,
} from '@ant-design/icons';
import { useDeployStream } from '@/hooks/useDeployStream';
import LogTerminal from '@/components/common/LogTerminal';

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
      <LogTerminal
        lines={logLines}
        status={deployStatus}
        successText="自动配置完成，节点已部署"
        failedText="配置失败，请查看上方日志"
        minHeight={300}
        maxHeight="calc(100vh - 280px)"
      />
    </Drawer>
  );
}
