'use client';

import { useState } from 'react';
import {
  App,
  Button,
  Table,
  Tag,
  Space,
  Popconfirm,
  Card,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '@/lib/api';
import ServerFormModal from '@/components/servers/ServerFormModal';
import AgentTokenModal from '@/components/servers/AgentTokenModal';
import AgentInstallDrawer from '@/components/servers/AgentInstallDrawer';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import type { Server } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

export default function ServersPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Server | null>(null);
  const [tokenTarget, setTokenTarget] = useState<Server | null>(null);
  const [installTarget, setInstallTarget] = useState<Server | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as Server[]),
    refetchInterval: 10_000,
  });
  if (isError) message.error('加载服务器失败');

  const deleteMutation = useMutation({
    mutationFn: (id: string) => serversApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      message.success('服务器已删除');
    },
    onError: () => message.error('删除失败'),
  });

  const [testingSshId, setTestingSshId] = useState<string | null>(null);
  const testSshMutation = useMutation({
    mutationFn: (id: string) => {
      setTestingSshId(id);
      return serversApi.testSsh(id);
    },
    onSuccess: (res) => {
      if (res.data.success) message.success('SSH 连接成功');
      else message.error(`SSH 连接失败: ${res.data.message}`);
    },
    onSettled: () => setTestingSshId(null),
  });

  const columns: ColumnType<Server>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (name, record) => (
        <Space direction="vertical" size={0}>
          <strong>{name}</strong>
          <small style={{ color: '#888' }}>{record.ip}</small>
        </Space>
      ),
    },
    { title: '区域', dataIndex: 'region' },
    { title: '提供商', dataIndex: 'provider' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string) => <StatusTag status={status} />,
    },
    {
      title: 'CPU / 内存',
      render: (_: unknown, record) =>
        record.cpuUsage != null ? (
          <span>
            {record.cpuUsage.toFixed(1)}% / {record.memUsage?.toFixed(1)}%
          </span>
        ) : (
          <span style={{ color: '#ccc' }}>—</span>
        ),
    },
    {
      title: 'Agent 版本',
      dataIndex: 'agentVersion',
      render: (v: string | null) => v ?? <span style={{ color: '#ccc' }}>未连接</span>,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>),
    },
    {
      title: '操作',
      render: (_: unknown, record) => (
        <Space>
          <Tooltip title="测试 SSH">
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              loading={testingSshId === record.id}
              onClick={() => testSshMutation.mutate(record.id)}
            />
          </Tooltip>
          <Tooltip title="Agent Token">
            <Button
              size="small"
              icon={<KeyOutlined />}
              onClick={() => setTokenTarget(record)}
            />
          </Tooltip>
          <Button
            size="small"
            onClick={() => {
              setEditTarget(record);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该服务器？"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="删除"
            okType="danger"
          >
            <Button size="small" danger icon={<ExclamationCircleOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="服务器管理"
        addLabel="新增服务器"
        onAdd={() => { setEditTarget(null); setModalOpen(true); }}
      />
      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data}
        columns={columns}
        pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
      />

      <ServerFormModal
        open={modalOpen}
        initialValues={editTarget as Record<string, unknown> | null}
        onClose={() => setModalOpen(false)}
        onSuccess={(server) => {
          setModalOpen(false);
          qc.invalidateQueries({ queryKey: ['servers'] });
          // 新增服务器后自动触发 Agent 安装
          if (!editTarget && server) {
            setInstallTarget(server as Server);
          }
        }}
      />

      {tokenTarget && (
        <AgentTokenModal
          open={!!tokenTarget}
          token={tokenTarget.agentToken}
          serverName={tokenTarget.name}
          onClose={() => setTokenTarget(null)}
        />
      )}

      {installTarget && (
        <AgentInstallDrawer
          open={!!installTarget}
          serverId={installTarget.id}
          serverName={installTarget.name}
          agentToken={installTarget.agentToken}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </Card>
  );
}
