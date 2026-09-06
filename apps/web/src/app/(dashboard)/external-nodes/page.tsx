'use client';

import { useState } from 'react';
import {
  App, Button, Table, Tag, Space, Modal, Input, Popconfirm, Typography, Tooltip, Select, theme as antdTheme,
} from 'antd';
import { DeleteOutlined, ApiOutlined, EditOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { externalNodesApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import AppCard from '@/components/common/AppCard';
import EmptyState from '@/components/common/EmptyState';
import { TableSkeleton } from '@/components/common/skeletons';
import { statusColors } from '@/theme/semantic';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { ExternalNode, ConnectivityResult } from '@/types/api';

const { TextArea } = Input;

/** 状态点脉冲动画（inline style 不支持 @keyframes，用 <style> 注入） */
const STATUS_DOT_CSS = `
.np-status-dot {
  transition: background-color 0.2s ease;
}
.np-status-dot-pulse {
  animation: np-status-dot-pulse 1.2s ease-in-out infinite;
}
@keyframes np-status-dot-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.6); opacity: 0.45; }
}
`;

/** 连通性状态点：颜色取自语义色板；pulse 用于"测试中"状态 */
function StatusDot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={pulse ? 'np-status-dot np-status-dot-pulse' : 'np-status-dot'}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

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
  const { isMobile } = useIsMobile();
  const { token } = antdTheme.useToken();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importProtocol, setImportProtocol] = useState<'HTTP' | 'SOCKS5'>('HTTP');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectivityResult>>({});
  const [renameNode, setRenameNode] = useState<ExternalNode | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['external-nodes'],
    queryFn: () => externalNodesApi.list().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const importMutation = useMutation({
    mutationFn: (text: string) => externalNodesApi.import(text, importProtocol),
    onSuccess: (res) => {
      const { success, failed } = res.data;
      qc.invalidateQueries({ queryKey: ['external-nodes'] });
      setImportOpen(false);
      setImportText('');
      setImportProtocol('HTTP');
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

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => externalNodesApi.rename(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['external-nodes'] });
      setRenameNode(null);
      setRenameValue('');
      message.success('节点已重命名');
    },
    onError: () => message.error('重命名失败'),
  });

  function openRename(node: ExternalNode) {
    setRenameNode(node);
    setRenameValue(node.name);
  }

  function submitRename() {
    const name = renameValue.trim();
    if (renameNode && name) renameMutation.mutate({ id: renameNode.id, name });
  }

  const allExternalColumns = [
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
        if (testingId === r.id) {
          return (
            <Space size={6}>
              <StatusDot color={statusColors.info} pulse />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>测试中</Typography.Text>
            </Space>
          );
        }
        const res = testResults[r.id];
        const source = res ?? (r.lastTestedAt ? { reachable: r.lastReachable, latency: r.lastLatency, testedAt: r.lastTestedAt } : null);
        if (!source) return <Tag>未测试</Tag>;
        return (
          <Space direction="vertical" size={2}>
            <Space size={6}>
              <StatusDot color={source.reachable ? statusColors.success : statusColors.error} />
              <Tag color={source.reachable ? 'green' : 'red'} style={{ marginRight: 0 }}>
                {source.reachable ? `${source.latency}ms` : '失败'}
              </Tag>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatTimeAgo(source.testedAt ?? null)}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, r: ExternalNode) => (
        <Space size={4}>
          <Tooltip title="重命名">
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => openRename(r)}
            />
          </Tooltip>
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

  const columns = isMobile
    ? allExternalColumns.filter((c) => (c as { title?: string }).title !== '地址')
    : allExternalColumns;

  return (
    <AppCard>
      <style>{STATUS_DOT_CSS}</style>
      <PageHeader
        title="外部节点"
        addLabel="导入节点"
        onAdd={() => setImportOpen(true)}
      />

      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : data.length === 0 ? (
        <EmptyState
          title="暂无外部节点"
          description="导入订阅链接或节点 URI，将第三方节点纳入统一管理与连通性测试"
          actionLabel="导入节点"
          onAction={() => setImportOpen(true)}
        />
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

      <Modal
        open={importOpen}
        title="导入节点"
        onCancel={() => { setImportOpen(false); setImportText(''); setImportProtocol('HTTP'); }}
        onOk={() => { if (importText.trim()) importMutation.mutate(importText.trim()); }}
        okText="导入"
        confirmLoading={importMutation.isPending}
        width={560}
        style={{ maxWidth: '95vw' }}
      >
        <div style={{ marginBottom: 8, color: token.colorTextSecondary, fontSize: 13 }}>
          支持订阅链接、Base64 订阅内容、节点 URI，以及 MiyaIP 四段格式（主机:端口:账号:密码）。无 scheme 的 MiyaIP 条目按所选协议导入。
        </div>
        <Select
          value={importProtocol}
          onChange={setImportProtocol}
          options={[{ label: 'MiyaIP 无 scheme：HTTP', value: 'HTTP' }, { label: 'MiyaIP 无 scheme：SOCKS5', value: 'SOCKS5' }]}
          style={{ width: '100%', marginBottom: 8 }}
        />
        <TextArea
          rows={8}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={`https://example.com/sub/token\n或\nvmess://...\nvless://...\nsocks://...`}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>

      <Modal
        open={!!renameNode}
        title="重命名节点"
        onCancel={() => { setRenameNode(null); setRenameValue(''); }}
        onOk={submitRename}
        okButtonProps={{ disabled: !renameValue.trim() }}
        confirmLoading={renameMutation.isPending}
        destroyOnHidden
        style={{ maxWidth: '95vw' }}
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={submitRename}
          placeholder="节点名称"
          maxLength={100}
          showCount
          autoFocus
        />
      </Modal>
    </AppCard>
  );
}
