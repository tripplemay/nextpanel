'use client';

import { useState } from 'react';
import { Modal, Spin, Typography, Empty, Tag, Space, Button, Collapse } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { operationLogsApi } from '@/lib/api';
import LogTerminal from '@/components/common/LogTerminal';
import type { Node, OperationLogEntry } from '@/types/api';

const { Text } = Typography;

interface Props {
  node: Node | null;
  onClose: () => void;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function LogText({ logId }: { logId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['operation-log', logId],
    queryFn: () => operationLogsApi.getLog(logId).then((r) => r.data),
  });

  if (isLoading) return <Spin size="small" />;
  if (!data?.log) return <Text type="secondary">暂无日志内容</Text>;

  return (
    <LogTerminal
      lines={data.log.split('\n')}
      minHeight={0}
      maxHeight={400}
      style={{ fontSize: 12, padding: 12, borderRadius: 4 }}
    />
  );
}

function OperationRow({ entry }: { entry: OperationLogEntry }) {
  const opLabel = entry.operation === 'DEPLOY' ? '部署' : entry.operation === 'UNDEPLOY' ? '删除' : entry.operation;
  const opColor = entry.operation === 'DEPLOY' ? 'blue' : entry.operation === 'UNDEPLOY' ? 'orange' : 'default';
  const time = new Date(entry.createdAt).toLocaleString('zh-CN');

  return (
    <Collapse
      size="small"
      items={[
        {
          key: entry.id,
          label: (
            <Space>
              {entry.success
                ? <CheckCircleOutlined style={{ color: '#3fb950' }} />
                : <CloseCircleOutlined style={{ color: '#f85149' }} />}
              <Tag color={opColor}>{opLabel}</Tag>
              <Text style={{ fontSize: 13 }}>{time}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                {formatDuration(entry.durationMs)}
              </Text>
              {!entry.success && <Tag color="error">失败</Tag>}
            </Space>
          ),
          children: <LogText logId={entry.id} />,
        },
      ]}
    />
  );
}

export default function DeployLogModal({ node, onClose }: Props) {
  const { data: entries, isLoading } = useQuery({
    queryKey: ['operation-logs', 'node', node?.id],
    queryFn: () => operationLogsApi.listByResource('node', node!.id).then((r) => r.data),
    enabled: !!node,
  });

  return (
    <Modal
      open={!!node}
      destroyOnHidden
      title={`操作日志 — ${node?.name ?? ''}`}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={760}
      style={{ maxWidth: '95vw' }}
    >
      {isLoading && <Spin style={{ display: 'block', margin: '32px auto' }} />}

      {!isLoading && (!entries || entries.length === 0) && (
        <Empty description="暂无操作日志" />
      )}

      {!isLoading && entries && entries.length > 0 && (
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          {entries.map((entry) => (
            <OperationRow key={entry.id} entry={entry} />
          ))}
        </Space>
      )}
    </Modal>
  );
}
