'use client';

import { useRef, useState } from 'react';
import { App, Button, Table, Tag, Space, Popconfirm, Card, Typography, Drawer, Badge } from 'antd';
import { PlusOutlined, ApiOutlined, CloudUploadOutlined, CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '@/lib/api';
import NodeFormModal from '@/components/nodes/NodeFormModal';
import type { ColumnType } from 'antd/es/table';

const { Title, Text } = Typography;

interface Node {
  id: string;
  serverId: string;
  name: string;
  protocol: string;
  implementation: string | null;
  transport: string | null;
  listenPort: number;
  tls: string;
  status: string;
  enabled: boolean;
}

const statusColor: Record<string, string> = {
  RUNNING: 'green',
  STOPPED: 'orange',
  ERROR: 'red',
  INACTIVE: 'default',
};

export default function NodesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Node | null>(null);

  // ── Deploy log drawer ──────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deployingNode, setDeployingNode] = useState<Node | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [deployStatus, setDeployStatus] = useState<'running' | 'success' | 'failed'>('running');
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then((r) => r.data as Node[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => nodesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      message.success('节点已删除');
    },
  });

  const [testingId, setTestingId] = useState<string | null>(null);
  const testMutation = useMutation({
    mutationFn: (id: string) => {
      setTestingId(id);
      return nodesApi.test(id).then((r) => r.data as { reachable: boolean; latency: number; message: string });
    },
    onSuccess: (res) => {
      if (res.reachable) message.success(res.message);
      else message.error(res.message);
    },
    onError: () => message.error('测试请求失败'),
    onSettled: () => setTestingId(null),
  });

  async function startDeploy(node: Node) {
    // Abort any ongoing stream
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setDeployingNode(node);
    setLogLines([]);
    setDeployStatus('running');
    setDrawerOpen(true);

    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : '';

    try {
      const res = await fetch(`/api/nodes/${node.id}/deploy-stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        setLogLines((prev) => [...prev, `Error: HTTP ${res.status}`]);
        setDeployStatus('failed');
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
            const json = JSON.parse(dataLine.slice(5).trim()) as {
              log?: string;
              done?: boolean;
              success?: boolean;
            };
            if (json.log) {
              setLogLines((prev) => {
                const next = [...prev, json.log!];
                // Auto-scroll
                setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
                return next;
              });
            }
            if (json.done) {
              setDeployStatus(json.success ? 'success' : 'failed');
              qc.invalidateQueries({ queryKey: ['nodes'] });
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setLogLines((prev) => [...prev, `连接中断: ${(err as Error).message}`]);
        setDeployStatus('failed');
      }
    }
  }

  function closeDrawer() {
    abortRef.current?.abort();
    setDrawerOpen(false);
  }

  const columns: ColumnType<Node>[] = [
    { title: '名称', dataIndex: 'name' },
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
      render: (_: unknown, r) => (
        <Tag color={statusColor[r.status]}>{r.enabled ? r.status : '已禁用'}</Tag>
      ),
    },
    {
      title: '操作',
      render: (_: unknown, record) => (
        <Space>
          <Button
            size="small"
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => startDeploy(record)}
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
            onClick={() => {
              setEditTarget(record);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该节点？"
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

  const drawerTitle = (
    <Space>
      <span>部署日志 — {deployingNode?.name}</span>
      {deployStatus === 'running' && <Badge status="processing" text="部署中" />}
      {deployStatus === 'success' && (
        <Text type="success">
          <CheckCircleFilled /> 部署成功
        </Text>
      )}
      {deployStatus === 'failed' && (
        <Text type="danger">
          <CloseCircleFilled /> 部署失败
        </Text>
      )}
    </Space>
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>节点管理</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => { setEditTarget(null); setModalOpen(true); }}
        >
          新增节点
        </Button>
      </div>
      <Table rowKey="id" loading={isLoading} dataSource={data} columns={columns} />

      <NodeFormModal
        open={modalOpen}
        initialValues={editTarget}
        onClose={() => setModalOpen(false)}
        onSuccess={() => { setModalOpen(false); qc.invalidateQueries({ queryKey: ['nodes'] }); }}
      />

      <Drawer
        open={drawerOpen}
        title={drawerTitle}
        width={640}
        onClose={closeDrawer}
        footer={
          deployStatus !== 'running' && (
            <Button type="primary" onClick={closeDrawer}>关闭</Button>
          )
        }
      >
        <div
          style={{
            background: '#0d1117',
            color: '#c9d1d9',
            fontFamily: 'monospace',
            fontSize: 13,
            padding: 16,
            borderRadius: 6,
            minHeight: 400,
            maxHeight: 'calc(100vh - 200px)',
            overflowY: 'auto',
            lineHeight: 1.7,
          }}
        >
          {logLines.length === 0 && deployStatus === 'running' && (
            <span style={{ color: '#8b949e' }}>
              <LoadingOutlined style={{ marginRight: 8 }} />
              正在连接服务器...
            </span>
          )}
          {logLines.map((line, i) => (
            <div key={i} style={{ color: line.includes('error') || line.includes('Error') || line.includes('失败') ? '#f85149' : '#c9d1d9' }}>
              {line}
            </div>
          ))}
          {deployStatus === 'success' && (
            <div style={{ color: '#3fb950', marginTop: 8 }}>✓ 部署完成</div>
          )}
          {deployStatus === 'failed' && (
            <div style={{ color: '#f85149', marginTop: 8 }}>✗ 部署失败，请检查以上日志</div>
          )}
          <div ref={logEndRef} />
        </div>
      </Drawer>
    </Card>
  );
}
