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
  Typography,
  Drawer,
  Alert,
  Input,
  Divider,
  Steps,
} from 'antd';
import {
  PlusOutlined,
  GithubOutlined,
  CodeOutlined,
  CopyOutlined,
  CheckOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pipelinesApi } from '@/lib/api';
import PipelineFormModal from '@/components/pipelines/PipelineFormModal';
import type { ColumnType } from 'antd/es/table';

const { Title, Text, Paragraph } = Typography;

interface Pipeline {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  workDir: string;
  enabled: boolean;
  createdAt: string;
}

interface GithubSecret {
  name: string;
  value: string;
  description: string;
}

interface GithubConfigResult {
  yaml: string;
  secrets: GithubSecret[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Button
      size="small"
      icon={copied ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined />}
      onClick={copy}
    >
      {copied ? '已复制' : '复制'}
    </Button>
  );
}

export default function GithubActionsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Pipeline | null>(null);

  const [configDrawerOpen, setConfigDrawerOpen] = useState(false);
  const [configTarget, setConfigTarget] = useState<Pipeline | null>(null);
  const [config, setConfig] = useState<GithubConfigResult | null>(null);
  const [configLoading, setConfigLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list().then((r) => r.data as Pipeline[]),
  });

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
      setConfig(res.data as GithubConfigResult);
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
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.branch}
          </Text>
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
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <GithubOutlined style={{ fontSize: 20 }} />
          <Title level={4} style={{ margin: 0 }}>
            GitHub Actions 自动部署
          </Title>
        </Space>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditTarget(null);
            setModalOpen(true);
          }}
        >
          新增部署配置
        </Button>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="工作原理"
        description="配置部署信息后，点击「查看配置」获取 GitHub Actions Workflow 文件和所需 Secrets。将 Workflow 文件提交到仓库，并在 GitHub 仓库 Settings → Secrets 中添加对应变量，之后每次 push 代码将自动触发部署。"
      />

      <Table rowKey="id" loading={isLoading} dataSource={data} columns={columns} />

      <PipelineFormModal
        open={modalOpen}
        initialValues={editTarget}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false);
          qc.invalidateQueries({ queryKey: ['pipelines'] });
        }}
      />

      {/* GitHub Actions Config Drawer */}
      <Drawer
        open={configDrawerOpen}
        title={
          <Space>
            <GithubOutlined />
            <span>GitHub Actions 配置 — {configTarget?.name}</span>
          </Space>
        }
        width={720}
        onClose={() => setConfigDrawerOpen(false)}
        loading={configLoading}
      >
        {config && (
          <>
            <Steps
              size="small"
              style={{ marginBottom: 24 }}
              items={[
                { title: '获取 Workflow 文件', status: 'finish', icon: <CodeOutlined /> },
                { title: '配置 GitHub Secrets', status: 'finish', icon: <KeyOutlined /> },
                { title: 'Push 代码触发部署', status: 'finish', icon: <GithubOutlined /> },
              ]}
            />

            {/* Step 1: Workflow YAML */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text strong>Step 1：将以下文件保存为 <Text code>.github/workflows/deploy.yml</Text></Text>
                <CopyButton text={config.yaml} />
              </div>
              <pre
                style={{
                  background: '#0d1117',
                  color: '#c9d1d9',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  padding: 16,
                  borderRadius: 6,
                  overflowX: 'auto',
                  maxHeight: 360,
                  overflowY: 'auto',
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                {config.yaml}
              </pre>
            </div>

            <Divider />

            {/* Step 2: Secrets */}
            <div>
              <Paragraph strong style={{ marginBottom: 12 }}>
                Step 2：在 GitHub 仓库 <Text code>Settings → Secrets and variables → Actions → New repository secret</Text> 中添加以下变量：
              </Paragraph>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {config.secrets.map((secret) => (
                  <div
                    key={secret.name}
                    style={{
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                      padding: '10px 14px',
                      background: '#fafafa',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Space>
                        <Text code strong style={{ fontSize: 13 }}>
                          {secret.name}
                        </Text>
                        {secret.description && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {secret.description}
                          </Text>
                        )}
                      </Space>
                      <CopyButton text={secret.value} />
                    </div>
                    <Input.Password
                      readOnly
                      value={secret.value}
                      size="small"
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <Divider />

            <Alert
              type="success"
              showIcon
              message="Step 3：推送代码自动部署"
              description={
                <>
                  完成以上配置后，向 <Text code>{configTarget?.branch}</Text> 分支推送代码，GitHub Actions 将自动触发部署流程。
                  也可在 GitHub 仓库的 <Text code>Actions</Text> 标签页手动触发（workflow_dispatch）。
                </>
              }
            />
          </>
        )}
      </Drawer>
    </Card>
  );
}
