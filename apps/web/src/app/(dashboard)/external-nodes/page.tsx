'use client';

import { useState } from 'react';
import {
  App, Button, Table, Tag, Space, Card, Modal, Input, Empty, Spin, Popconfirm, Typography, Tooltip,
} from 'antd';
import { ImportOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { externalNodesApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import type { ExternalNode, ConnectivityResult } from '@/types/api';

const { TextArea } = Input;

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export default function ExternalNodesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectivityResult>>({});

  const { data = [], isLoading } = useQuery({
    queryKey: ['external-nodes'],
    queryFn: () => externalNodesApi.list().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const importMutation = useMutation({
    mutationFn: (text: string) => externalNodesApi.import(text),
    onSuccess: (res) => {
      const { success, failed } = res.data;
      qc.invalidateQueries({ queryKey: ['external-nodes'] });
      setImportOpen(false);
      setImportText('');
      if (success > 0) {
        message.success(`导入成功 ${success} 个节点${failed > 0 ? `，${failed} 个解析失败` : ''}`);
      } else {
        message.warning(`未能解析出有效节点（${failed} 个失败）`);
      }
    },
    onError: () => message.error('导入失败'),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => {
      setTestingId(id);
      return externalNodesApi.test(id).then((r) => r.data);
    },
    onSuccess: (res, id) => {
      setTestResults((prev) => ({ ...prev, [id]: res }));
      if (res.reachable) message.success(res.message);
      else message.error(res.message);
    },
    onError: () => message.error('测试失败'),
    onSettled: () => setTestingId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => externalNodesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['external-nodes'] });
      message.success('已删除');
    },
    onError: () => message.error('删除失败'),
  });

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (name: string) => (
        <Space size={4}>
          {name}
          <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>外部</Tag>
        </Space>
      ),
    },
    {
      title: '协议',
      dataIndex: 'protocol',
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '地址',
      render: (_: unknown, r: ExternalNode) => (
        <Typography.Text copyable style={{ fontSize: 13 }}>
          {r.address}:{r.port}
        </Typography.Text>
      ),
    },
    {
      title: '连通性',
      width: 110,
      render: (_: unknown, r: ExternalNode) => {
        if (testingId === r.id) return <Spin size="small" />;
        const res = testResults[r.id];
        const source = res ?? (r.lastTestedAt ? { reachable: r.lastReachable, latency: r.lastLatency, testedAt: r.lastTestedAt } : null);
        if (!source) return <Tag>未测试</Tag>;
        return (
          <Space direction="vertical" size={2}>
            <Tag color={source.reachable ? 'green' : 'red'} style={{ marginRight: 0 }}>
              {source.reachable ? `${source.latency}ms` : '失败'}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatTimeAgo(source.testedAt ?? null)}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, r: ExternalNode) => (
        <Space size={4}>
          <Tooltip title="测试连通性">
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={testingId === r.id}
              onClick={() => testMutation.mutate(r.id)}
            >
              测试
            </Button>
          </Tooltip>
          <Popconfirm
            title="确认删除该节点？"
            onConfirm={() => deleteMutation.mutate(r.id)}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="外部节点"
        addLabel="导入节点"
        onAdd={() => setImportOpen(true)}
      />

      <Spin spinning={isLoading}>
        {!isLoading && data.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无外部节点" style={{ padding: '32px 0' }} />
        ) : (
          <Table
            rowKey="id"
            size="middle"
            dataSource={data}
            columns={columns}
            scroll={{ x: 'max-content' }}
            pagination={{ showTotal: (total) => `共 ${total} 条` }}
          />
        )}
      </Spin>

      <Modal
        open={importOpen}
        title="导入节点"
        onCancel={() => { setImportOpen(false); setImportText(''); }}
        onOk={() => { if (importText.trim()) importMutation.mutate(importText.trim()); }}
        okText="导入"
        confirmLoading={importMutation.isPending}
        width={560}
      >
        <div style={{ marginBottom: 8, color: '#8c8c8c', fontSize: 13 }}>
          支持粘贴单个或多个 URI（vmess:// vless:// ss:// trojan:// hysteria2://），或 Base64 编码的订阅内容
        </div>
        <TextArea
          rows={8}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={`vmess://...\nvless://...\nss://...`}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>
    </Card>
  );
}
