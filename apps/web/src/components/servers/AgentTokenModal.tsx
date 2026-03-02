'use client';

import { Modal, Typography, Space, Flex } from 'antd';
import CopyButton from '@/components/common/CopyButton';

const { Text } = Typography;

interface Props {
  open: boolean;
  token: string;
  serverName: string;
  onClose: () => void;
}

export default function AgentTokenModal({ open, token, serverName, onClose }: Props) {
  return (
    <Modal
      open={open}
      title={`Agent Token — ${serverName}`}
      onCancel={onClose}
      footer={null}
      width={520}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Text type="secondary">将此 Token 填入 Agent 配置文件的 agentToken 字段。</Text>
        <Flex gap={8} align="flex-start">
          <Text
            code
            style={{
              flex: 1,
              padding: '6px 10px',
              background: '#f5f5f5',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              wordBreak: 'break-all',
              fontSize: 13,
            }}
          >
            {token}
          </Text>
          <CopyButton text={token} />
        </Flex>
      </Space>
    </Modal>
  );
}
