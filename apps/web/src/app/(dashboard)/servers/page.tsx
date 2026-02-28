'use client';

import { useState } from 'react';
import {
  App,
  Button,
  Table,
  Tag,
  Space,
  Popconfirm,
  Badge,
  Card,
  Typography,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '@/lib/api';
import ServerFormModal from '@/components/servers/ServerFormModal';
import type { ColumnType } from 'antd/es/table';

const { Title } = Typography;

interface Server {

  id: string;
  name: string;
  ip: string;
  region: string;
  provider: string;
  status: string;
  cpuUsage: number | null;
  memUsage: number | null;
  lastSeenAt: string | null;
  agentVersion: string | null;
  tags: string[];
}

const statusColor: Record<string, string> = {
  ONLINE: 'green',
  OFFLINE: 'red',
  UNKNOWN: 'default',
  ERROR: 'orange',
};

export default function ServersPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Server | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as Server[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => serversApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      message.success('服务器已删除');
    },
  });

  const testSshMutation = useMutation({
    mutationFn: (id: string) => serversApi.testSsh(id),
    onSuccess: (res) => {
      if (res.data.success) message.success('SSH 连接成功');
      else message.error(`SSH 连接失败: ${res.data.message}`);
    },
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
      render: (status: string) => (
        <Badge
          status={status === 'ONLINE' ? 'success' : status === 'OFFLINE' ? 'error' : 'default'}
          text={<Tag color={statusColor[status]}>{status}</Tag>}
        />
      ),
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
              loading={testSshMutation.isPending}
              onClick={() => testSshMutation.mutate(record.id)}
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
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          服务器管理
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditTarget(null);
            setModalOpen(true);
          }}
        >
          新增服务器
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        columns={columns}
        pagination={{ pageSize: 10 }}
      />

      <ServerFormModal
        open={modalOpen}
        initialValues={editTarget}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false);
          qc.invalidateQueries({ queryKey: ['servers'] });
        }}
      />
    </Card>
  );
}
