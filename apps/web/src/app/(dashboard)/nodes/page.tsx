'use client';

import { useRef, useState } from 'react';
import { App, Button, Table, Tag, Space, Popconfirm, Card, Spin, Modal, Input } from 'antd';
import { ApiOutlined, CloudUploadOutlined, ShareAltOutlined, FileTextOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '@/lib/api';
import NodePresetModal from '@/components/nodes/NodePresetModal';
import NodeFormModal from '@/components/nodes/NodeFormModal';
import DeployDrawer from '@/components/nodes/DeployDrawer';
import NodeShareModal from '@/components/nodes/NodeShareModal';
import DeployLogModal from '@/components/nodes/DeployLogModal';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import { useDeployStream } from '@/hooks/useDeployStream';
import type { Node, ConnectivityResult } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

export default function NodesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  // Modals
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Node | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Rename modal
  const [renameNode, setRenameNode] = useState<Node | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Deploy / delete drawers
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deployingNode, setDeployingNode] = useState<Node | null>(null);
  const [deleteDrawerOpen, setDeleteDrawerOpen] = useState(false);
  const [deletingNode, setDeletingNode] = useState<Node | null>(null);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [shareNode, setShareNode] = useState<Node | null>(null);
  const [logNode, setLogNode] = useState<Node | null>(null);

  // Connectivity test results keyed by node id
  const [testResults, setTestResults] = useState<Record<string, ConnectivityResult>>({});
  const [batchTesting, setBatchTesting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const abortBatchRef = useRef<AbortController | null>(null);

  const { logLines, deployStatus, startStream, abort, reset } = useDeployStream();
  const {
    logLines: deleteLogLines,
    deployStatus: deleteStatus,
    startStream: startDeleteStream,
    abort: abortDelete,
    reset: resetDelete,
  } = useDeployStream();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then((r) => r.data),
  });

  if (isError) message.error('加载节点失败');

  const testMutation = useMutation({
    mutationFn: (id: string) => {
      setTestingId(id);
      return nodesApi.test(id).then((r) => r.data);
    },
    onSuccess: (res, id) => {
      setTestResults((prev) => ({ ...prev, [id]: res }));
      if (res.reachable) message.success(res.message);
      else message.error(res.message);
    },
    onError: () => message.error('测试请求失败'),
    onSettled: () => setTestingId(null),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      nodesApi.rename(id, name).then((r) => r.data),
    onSuccess: () => {
      message.success('节点已重命名');
      setRenameNode(null);
      qc.invalidateQueries({ queryKey: ['nodes'] });
    },
    onError: () => message.error('重命名失败'),
  });

  const regenMutation = useMutation({
    mutationFn: (id: string) => nodesApi.regenerateCredentials(id).then((r) => r.data),
    onSuccess: () => message.success('凭证已更新，节点重新部署中…'),
    onError: () => message.error('更新凭证失败'),
  });

  async function startBatchTest() {
    if (batchTesting) {
      abortBatchRef.current?.abort();
      return;
    }

    const nodes = data ?? [];
    if (nodes.length === 0) return;

    setBatchTesting(true);
    setBatchProgress({ done: 0, total: nodes.length });
    setTestResults({});
    abortBatchRef.current = new AbortController();

    const token = typeof window !== 'undefined' ? (localStorage.getItem('access_token') ?? '') : '';

    try {
      const res = await fetch('/api/nodes/test-all', {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortBatchRef.current.signal,
      });

      if (!res.ok || !res.body) {
        void message.error('批量测试请求失败');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
            if (event.type === 'result') {
              const nodeId = event.nodeId as string;
              setTestResults((prev) => ({
                ...prev,
                [nodeId]: {
                  reachable: event.reachable as boolean,
                  latency: event.latency as number,
                  message: event.message as string,
                  testedAt: event.testedAt as string,
                },
              }));
              setBatchProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : null);
            } else if (event.type === 'done') {
              void message.success(`批量测试完成，共 ${event.total as number} 个节点`);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        void message.error('批量测试连接中断');
      }
    } finally {
      setBatchTesting(false);
      setBatchProgress(null);
    }
  }

  function openDeploy(node: Node) {
    reset();
    setDeployingNode(node);
    setDrawerOpen(true);
    void startStream(`/api/nodes/${node.id}/deploy-stream`, (success) => {
      if (success) qc.invalidateQueries({ queryKey: ['nodes'] });
    });
  }

  function closeDrawer() {
    abort();
    setDrawerOpen(false);
  }

  function openDelete(node: Node) {
    resetDelete();
    setDeletingNode(node);
    setDeleteDrawerOpen(true);
    void startDeleteStream(`/api/nodes/${node.id}/delete-stream`, (success) => {
      if (success) qc.invalidateQueries({ queryKey: ['nodes'] });
    });
  }

  function closeDeleteDrawer() {
    abortDelete();
    setDeleteDrawerOpen(false);
  }

  function openRename(node: Node) {
    setRenameNode(node);
    setRenameValue(node.name);
  }

  const columns: ColumnType<Node>[] = [
    {
      title: '名称',
      render: (_: unknown, r) => (
        <Space>
          {r.name}
          {r.source === 'AUTO' && <Tag color="geekblue" style={{ fontSize: 10 }}>AUTO</Tag>}
        </Space>
      ),
    },
    {
      title: '协议',
      render: (_: unknown, r) => (
        <Space>
          <Tag color="blue">{r.protocol}</Tag>
          {r.implementation && <Tag>{r.implementation}</Tag>}
          {r.transport && <Tag>{r.transport}</Tag>}
          {r.tls !== 'NONE' && <Tag color="green">{r.tls}</Tag>}
        </Space>
      ),
    },
    { title: '端口', dataIndex: 'listenPort' },
    {
      title: '状态',
      render: (_: unknown, r) => <StatusTag status={r.status} enabled={r.enabled} />,
    },
    {
      title: '连通性',
      width: 100,
      render: (_: unknown, r) => {
        if (testingId === r.id || (batchTesting && !testResults[r.id])) {
          return <Spin size="small" />;
        }
        const result = testResults[r.id];
        if (!result) return <Tag>-</Tag>;
        if (result.reachable) return <Tag color="green">{result.latency}ms</Tag>;
        return <Tag color="red">失败</Tag>;
      },
    },
    {
      title: '操作',
      render: (_: unknown, record) => (
        <Space wrap>
          <Button
            size="small"
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => openDeploy(record)}
          >
            部署
          </Button>
          <Button
            size="small"
            icon={<ApiOutlined />}
            loading={testingId === record.id}
            onClick={() => testMutation.mutate(record.id)}
          >
            测试
          </Button>
          <Button
            size="small"
            icon={<ShareAltOutlined />}
            onClick={() => setShareNode(record)}
          >
            分享
          </Button>
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => setLogNode(record)}
          >
            日志
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openRename(record)}
          >
            重命名
          </Button>
          {record.source === 'AUTO' ? (
            <Popconfirm
              title="重新生成凭证并重新部署？"
              description="旧客户端配置将失效，需重新导入"
              onConfirm={() => regenMutation.mutate(record.id)}
              okText="确认"
            >
              <Button size="small" icon={<ReloadOutlined />} loading={regenMutation.isPending}>
                更新凭证
              </Button>
            </Popconfirm>
          ) : (
            <Button
              size="small"
              onClick={() => {
                setEditTarget(record);
                setEditModalOpen(true);
              }}
            >
              编辑
            </Button>
          )}
          <Popconfirm
            title="确认删除该节点？"
            description="将同步停止并移除代理服务器上的对应服务"
            onConfirm={() => openDelete(record)}
            okText="删除"
            okType="danger"
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const batchTestButton = (
    <Button
      icon={<ApiOutlined />}
      loading={batchTesting}
      onClick={() => void startBatchTest()}
    >
      {batchTesting && batchProgress
        ? `测试中 ${batchProgress.done}/${batchProgress.total}`
        : '批量测试'}
    </Button>
  );

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="节点管理"
        addLabel="新增节点"
        onAdd={() => setPresetModalOpen(true)}
        extra={batchTestButton}
      />
      <Table rowKey="id" size="middle" loading={isLoading} dataSource={data} columns={columns} pagination={{ showTotal: (total) => `共 ${total} 条` }} />

      <NodePresetModal
        open={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        onSuccess={(node) => {
          setPresetModalOpen(false);
          qc.invalidateQueries({ queryKey: ['nodes'] });
          openDeploy(node);
        }}
      />

      <NodeFormModal
        open={editModalOpen}
        initialValues={editTarget as Record<string, unknown> | null}
        onClose={() => setEditModalOpen(false)}
        onSuccess={() => {
          setEditModalOpen(false);
          qc.invalidateQueries({ queryKey: ['nodes'] });
        }}
      />

      <Modal
        open={!!renameNode}
        title="重命名节点"
        onCancel={() => setRenameNode(null)}
        onOk={() => {
          if (renameNode && renameValue.trim()) {
            renameMutation.mutate({ id: renameNode.id, name: renameValue.trim() });
          }
        }}
        confirmLoading={renameMutation.isPending}
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={() => {
            if (renameNode && renameValue.trim()) {
              renameMutation.mutate({ id: renameNode.id, name: renameValue.trim() });
            }
          }}
          placeholder="节点名称"
          style={{ marginTop: 8 }}
        />
      </Modal>

      <DeployDrawer
        open={drawerOpen}
        nodeName={deployingNode?.name ?? null}
        logLines={logLines}
        deployStatus={deployStatus}
        onClose={closeDrawer}
      />

      <DeployDrawer
        open={deleteDrawerOpen}
        nodeName={deletingNode?.name ?? null}
        logLines={deleteLogLines}
        deployStatus={deleteStatus}
        onClose={closeDeleteDrawer}
        actionLabel="删除"
      />

      <NodeShareModal node={shareNode} onClose={() => setShareNode(null)} />

      <DeployLogModal node={logNode} onClose={() => setLogNode(null)} />
    </Card>
  );
}
