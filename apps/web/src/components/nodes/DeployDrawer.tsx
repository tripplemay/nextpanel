'use client';

import { Drawer, Modal, Button, Space, Badge, Typography } from 'antd';
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { DeployStatus } from '@/hooks/useDeployStream';
import { useIsMobile } from '@/hooks/useIsMobile';
import LogTerminal from '@/components/common/LogTerminal';

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
  const { isMobile } = useIsMobile();

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
    <LogTerminal
      lines={logLines}
      status={deployStatus}
      successText={`${actionLabel}完成`}
      failedText={`${actionLabel}失败，请检查以上日志`}
      minHeight={200}
      maxHeight={isMobile ? undefined : 'calc(100vh - 200px)'}
    />
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
          container: { borderRadius: 0, height: '100dvh', display: 'flex', flexDirection: 'column' },
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
      {logContent}
    </Drawer>
  );
}
