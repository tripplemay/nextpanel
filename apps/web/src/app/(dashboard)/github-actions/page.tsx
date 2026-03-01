'use client';

import { useState } from 'react';
import { App, Button, Table, Tag, Space, Popconfirm, Card, Alert, Typography } from 'antd';
import { GithubOutlined, CodeOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pipelinesApi } from '@/lib/api';
import PipelineFormModal from '@/components/pipelines/PipelineFormModal';
import ConfigDrawer from '@/components/pipelines/ConfigDrawer';
import PageHeader from '@/components/common/PageHeader';
import type { Pipeline, GithubConfig } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

const { Text } = Typography;

export default function GithubActionsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Pipeline | null>(null);
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [configTarget, setConfigTarget] = useState<Pipeline | null>(null);
  const [config, setConfig] = useState<GithubConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list().then((r) => r.data),
  });

  if (isError) message.error('加载部署配置失败');

  const deleteMutation = useMutation({
    mutationFn: (id: string) => pipelinesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines'] });
      message.success('配置已删除');
    },
    onError: () => message.error('删除失败'),
  });

  async function openConfig(pipeline: Pipeline) {
    setConfigTarget(pipeline);
    setConfig(null);
    setConfigDrawerOpen(true);
    setConfigLoading(true);
    try {
      const res = await pipelinesApi.githubConfig(pipeline.id);
      setConfig(res.data);
    } catch {
      message.error('获取配置失败');
    } finally {
      setConfigLoading(false);
    }
  }

  const columns: ColumnType<Pipeline>[] = [
    {
      title: '名称',
      render: (_: unknown, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{r.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.branch}</Text>
        </Space>
      ),
    },
    {
      title: '仓库',
      render: (_: unknown, r) => (
        <a href={r.repoUrl} target="_blank" rel="noopener noreferrer">
          <GithubOutlined style={{ marginRight: 4 }} />
          {r.repoUrl.replace('https://github.com/', '')}
        </a>
      ),
    },
    {
      title: '工作目录',
      dataIndex: 'workDir',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '启用',
      render: (_: unknown, r) => (
        <Tag color={r.enabled ? 'green' : 'default'}>{r.enabled ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '操作',
      render: (_: unknown, record) => (
        <Space wrap>
          <Button
            size="small"
            type="primary"
            icon={<CodeOutlined />}
            onClick={() => openConfig(record)}
          >
            查看配置
          </Button>
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
            title="确认删除该部署配置？"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="删除"
            okType="danger"
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="GitHub Actions 自动部署"
        addLabel="新增部署配置"
        onAdd={() => { setEditTarget(null); setModalOpen(true); }}
        extra={<GithubOutlined style={{ fontSize: 20 }} />}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="工作原理"
        description="配置部署信息后，点击「查看配置」获取 GitHub Actions Workflow 文件和所需 Secrets。将 Workflow 文件提交到仓库，并在 GitHub 仓库 Settings → Secrets 中添加对应变量，之后每次 push 代码将自动触发部署。"
      />

      <Table rowKey="id" size="middle" loading={isLoading} dataSource={data} columns={columns} pagination={{ showTotal: (total) => `共 ${total} 条` }} />

      <PipelineFormModal
        open={modalOpen}
        initialValues={editTarget as Record<string, unknown> | null}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false);
          qc.invalidateQueries({ queryKey: ['pipelines'] });
        }}
      />

      <ConfigDrawer
        open={configDrawerOpen}
        pipelineName={configTarget?.name ?? null}
        pipelineBranch={configTarget?.branch}
        config={config}
        loading={configLoading}
        onClose={() => setConfigDrawerOpen(false)}
      />
    </Card>
  );
}
