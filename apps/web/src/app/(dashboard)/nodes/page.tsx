'use client';

import { useState } from 'react';
import { App, Button, Table, Tag, Space, Popconfirm, Card, Modal, Typography } from 'antd';
import { ApiOutlined, CloudUploadOutlined, ShareAltOutlined, FileTextOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '@/lib/api';
import NodeFormModal from '@/components/nodes/NodeFormModal';
import DeployDrawer from '@/components/nodes/DeployDrawer';
import NodeShareModal from '@/components/nodes/NodeShareModal';
import DeployLogModal from '@/components/nodes/DeployLogModal';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import { useDeployStream } from '@/hooks/useDeployStream';
import type { Node } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

export default function NodesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Node | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deployingNode, setDeployingNode] = useState<Node | null>(null);
  const [deleteDrawerOpen, setDeleteDrawerOpen] = useState(false);
  const [deletingNode, setDeletingNode] = useState<Node | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [shareNode, setShareNode] = useState<Node | null>(null);
  const [logNode, setLogNode] = useState<Node | null>(null);

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
    onSuccess: (res) => {
      if (res.reachable) message.success(res.message);
      else message.error(res.message);
    },
    onError: () => message.error('测试请求失败'),
    onSettled: () => setTestingId(null),
  });

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
      render: (_: unknown, r) => <StatusTag status={r.status} enabled={r.enabled} />,
    },
    {
      title: '操作',
      render: (_: unknown, record) => (
        <Space>
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
            onClick={() => {
              setEditTarget(record);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
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

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="节点管理"
        addLabel="新增节点"
        onAdd={() => { setEditTarget(null); setModalOpen(true); }}
      />
      <Table rowKey="id" size="middle" loading={isLoading} dataSource={data} columns={columns} pagination={{ showTotal: (total) => `共 ${total} 条` }} />

      <NodeFormModal
        open={modalOpen}
        initialValues={editTarget as Record<string, unknown> | null}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false);
          qc.invalidateQueries({ queryKey: ['nodes'] });
        }}
      />

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
