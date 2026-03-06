'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { App, Button, Table, Tag, Space, Card, Spin, Modal, Input, Switch, Dropdown, Typography, Collapse, Empty, Tooltip } from 'antd';
import { ApiOutlined, ShareAltOutlined, FileTextOutlined, EditOutlined, CloudUploadOutlined, EllipsisOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';
import NodePresetModal from '@/components/nodes/NodePresetModal';
import DeployDrawer from '@/components/nodes/DeployDrawer';
import NodeShareModal from '@/components/nodes/NodeShareModal';
import DeployLogModal from '@/components/nodes/DeployLogModal';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import { useDeployStream } from '@/hooks/useDeployStream';
import type { Node, Server, ConnectivityResult } from '@/types/api';
import type { ColumnType } from 'antd/es/table';


function formatBytes(bytes: number, hasStats: boolean): string {
  if (!hasStats) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
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

export default function NodesPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  // Modals
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [presetServerId, setPresetServerId] = useState<string | undefined>(undefined);

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
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Connectivity test results keyed by node id (in-session overrides persisted data)
  const [testResults, setTestResults] = useState<Record<string, ConnectivityResult>>({});
  const [batchTesting, setBatchTesting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const abortBatchRef = useRef<AbortController | null>(null);

  // Collapse state: track collapsed server IDs
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);

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
    staleTime: 2 * 60 * 1000,
  });

  const { data: servers, isLoading: serversLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data),
    refetchInterval: 30_000,
  });

  if (isError) message.error('加载节点失败');

  // Group nodes by server
  const groups = useMemo(() => {
    if (!servers) return [];
    const nodesByServer = new Map<string, Node[]>();
    for (const node of (data ?? [])) {
      const arr = nodesByServer.get(node.serverId) ?? [];
      arr.push(node);
      nodesByServer.set(node.serverId, arr);
    }
    return servers.map((server) => ({
      server,
      nodes: nodesByServer.get(server.id) ?? [],
    }));
  }, [servers, data]);

  // All servers expanded by default; track collapsed ones
  const activeKeys = useMemo(
    () => groups.map((g) => g.server.id).filter((id) => !collapsedIds.includes(id)),
    [groups, collapsedIds],
  );

  const testMutation = useMutation({
    mutationFn: (id: string) => {
      setTestingId(id);
      return nodesApi.test(id).then((r) => r.data);
    },
    onSuccess: (res, id) => {
      setTestResults((prev) => ({ ...prev, [id]: res }));
      if (res.reachable) message.success(res.message);
      else message.error(res.message);
      // Refresh to pick up persisted lastTestedAt
      qc.invalidateQueries({ queryKey: ['nodes'] });
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

  const toggleMutation = useMutation({
    mutationFn: (id: string) => {
      setTogglingId(id);
      return nodesApi.toggle(id).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
    },
    onError: () => message.error('切换节点状态失败'),
    onSettled: () => setTogglingId(null),
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

    const token = useAuthStore.getState().token ?? '';

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
              qc.invalidateQueries({ queryKey: ['nodes'] });
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

  const openDeploy = useCallback((node: Node) => {
    reset();
    setDeployingNode(node);
    setDrawerOpen(true);
    void startStream(`/api/nodes/${node.id}/deploy-stream`, (success) => {
      if (success) qc.invalidateQueries({ queryKey: ['nodes'] });
    });
  }, [reset, startStream, qc]);

  function closeDrawer() {
    abort();
    setDrawerOpen(false);
  }

  const openDelete = useCallback((node: Node) => {
    resetDelete();
    setDeletingNode(node);
    setDeleteDrawerOpen(true);
    void startDeleteStream(`/api/nodes/${node.id}/delete-stream`, (success) => {
      if (success) qc.invalidateQueries({ queryKey: ['nodes'] });
    });
  }, [resetDelete, startDeleteStream, qc]);

  function closeDeleteDrawer() {
    abortDelete();
    setDeleteDrawerOpen(false);
  }

  const openRename = useCallback((node: Node) => {
    setRenameNode(node);
    setRenameValue(node.name);
  }, []);

  function openPresetForServer(serverId: string) {
    setPresetServerId(serverId);
    setPresetModalOpen(true);
  }

  const columns: ColumnType<Node>[] = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
    },
    {
      title: '协议',
      render: (_: unknown, r) => (
        <Space size={4}>
          <Tag color="blue">{r.protocol}</Tag>
          {r.transport && <Tag>{r.transport}</Tag>}
          {r.tls !== 'NONE' && <Tag color="green">{r.tls}</Tag>}
        </Space>
      ),
    },
    { title: '端口', dataIndex: 'listenPort', width: 80 },
    {
      title: '状态',
      width: 90,
      render: (_: unknown, r) => <StatusTag status={r.status} enabled={r.enabled} />,
    },
    {
      title: '启用',
      width: 70,
      render: (_: unknown, r) => (
        <Switch
          size="small"
          checked={r.enabled}
          loading={togglingId === r.id}
          onChange={() => toggleMutation.mutate(r.id)}
        />
      ),
    },
    {
      title: <Tooltip title="自上次部署/重启起累计上传流量">↑上传</Tooltip>,
      width: 90,
      render: (_: unknown, r) => formatBytes(r.trafficUpBytes, r.statsPort !== null),
    },
    {
      title: <Tooltip title="自上次部署/重启起累计下载流量">↓下载</Tooltip>,
      width: 90,
      render: (_: unknown, r) => formatBytes(r.trafficDownBytes, r.statsPort !== null),
    },
    {
      title: '连通性',
      width: 130,
      render: (_: unknown, r) => {
        const sessionResult = testResults[r.id];
        const isTestingThis = testingId === r.id || (batchTesting && !sessionResult);

        if (isTestingThis) return <Spin size="small" />;

        if (sessionResult) {
          if (sessionResult.reachable) {
            return (
              <Space size={4}>
                <Tag color="green" style={{ marginRight: 0 }}>{sessionResult.latency}ms</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatTimeAgo(sessionResult.testedAt)}</Typography.Text>
              </Space>
            );
          }
          return <Tag color="red">失败</Tag>;
        }

        if (r.lastTestedAt) {
          if (r.lastReachable) {
            return (
              <Space size={4}>
                <Tag color="green" style={{ marginRight: 0 }}>{r.lastLatency}ms</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatTimeAgo(r.lastTestedAt)}</Typography.Text>
              </Space>
            );
          }
          return (
            <Space size={4}>
              <Tag color="red" style={{ marginRight: 0 }}>失败</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatTimeAgo(r.lastTestedAt)}</Typography.Text>
            </Space>
          );
        }

        return <Tag>未测试</Tag>;
      },
    },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, record) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<ShareAltOutlined />}
            onClick={() => setShareNode(record)}
          >
            分享
          </Button>
          <Button
            size="small"
            icon={<ApiOutlined />}
            loading={testingId === record.id}
            onClick={() => testMutation.mutate(record.id)}
          >
            测试
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'deploy',
                  icon: <CloudUploadOutlined />,
                  label: '部署',
                  onClick: () => openDeploy(record),
                },
                {
                  key: 'log',
                  icon: <FileTextOutlined />,
                  label: '日志',
                  onClick: () => setLogNode(record),
                },
                {
                  key: 'rename',
                  icon: <EditOutlined />,
                  label: '重命名',
                  onClick: () => openRename(record),
                },
                { type: 'divider' },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: '删除',
                  danger: true,
                  onClick: () => {
                    modal.confirm({
                      title: '确认删除该节点？',
                      content: '将同步停止并移除代理服务器上的对应服务',
                      okText: '删除',
                      okType: 'danger',
                      cancelText: '取消',
                      onOk: () => openDelete(record),
                    });
                  },
                },
              ],
            }}
            trigger={['click']}
          >
            <Button size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [testResults, testingId, batchTesting, togglingId, toggleMutation, testMutation, modal, openDeploy, openDelete, openRename]);

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

  const collapseItems = groups.map(({ server, nodes: serverNodes }) => ({
    key: server.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span style={{ fontWeight: 500 }}>{server.name}</span>
        {server.countryCode && (
          <span
            className={`fi fi-${server.countryCode.toLowerCase()} fis`}
            style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }}
          />
        )}
        {server.region && <Tag style={{ margin: 0 }}>{server.region}</Tag>}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{server.ip}</Typography.Text>
        <StatusTag status={server.status} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{serverNodes.length} 个节点</Typography.Text>
        <div style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => openPresetForServer(server.id)}
          >
            新增节点
          </Button>
        </div>
      </div>
    ),
    children: serverNodes.length > 0 ? (
      <Table
        rowKey="id"
        size="middle"
        dataSource={serverNodes}
        columns={columns}
        pagination={serverNodes.length > 10 ? { showTotal: (total) => `共 ${total} 条` } : false}
      />
    ) : (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            暂无节点，
            <a onClick={() => openPresetForServer(server.id)}>点击新增</a>
          </span>
        }
        style={{ padding: '16px 0' }}
      />
    ),
  }));

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="节点管理"
        addLabel="新增节点"
        onAdd={() => {
          setPresetServerId(undefined);
          setPresetModalOpen(true);
        }}
        extra={batchTestButton}
      />
      <Spin spinning={isLoading || serversLoading}>
        <Collapse
          activeKey={activeKeys}
          onChange={(keys) => {
            const activeSet = new Set(Array.isArray(keys) ? keys : [keys]);
            setCollapsedIds(groups.map((g) => g.server.id).filter((id) => !activeSet.has(id)));
          }}
          items={collapseItems}
          style={{ background: 'transparent' }}
        />
      </Spin>

      <NodePresetModal
        open={presetModalOpen}
        onClose={() => {
          setPresetModalOpen(false);
          setPresetServerId(undefined);
        }}
        onSuccess={(node) => {
          setPresetModalOpen(false);
          setPresetServerId(undefined);
          qc.invalidateQueries({ queryKey: ['nodes'] });
          openDeploy(node);
        }}
        defaultServerId={presetServerId}
      />

      <Modal
        open={!!renameNode}
        destroyOnClose
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
