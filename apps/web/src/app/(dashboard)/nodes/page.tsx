'use client';

import { useState } from 'react';
import { App, Button, Table, Tag, Space, Popconfirm, Card } from 'antd';
import { PlusOutlined, ApiOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '@/lib/api';
import NodeFormModal from '@/components/nodes/NodeFormModal';
import DeployDrawer from '@/components/nodes/DeployDrawer';
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
  const [testingId, setTestingId] = useState<string | null>(null);

  const { logLines, deployStatus, startDeploy, abort, reset } = useDeployStream();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then((r) => r.data),
  });

  if (isError) message.error('加载节点失败');

  const deleteMutation = useMutation({
    mutationFn: (id: string) => nodesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      message.success('节点已删除');
    },
    onError: () => message.error('删除失败'),
  });

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
    startDeploy(node.id, (success) => {
      if (success) qc.invalidateQueries({ queryKey: ['nodes'] });
    });
  }

  function closeDrawer() {
    abort();
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

  return (
    <Card>
      <PageHeader
        title="节点管理"
        addLabel="新增节点"
        onAdd={() => { setEditTarget(null); setModalOpen(true); }}
      />
      <Table rowKey="id" loading={isLoading} dataSource={data} columns={columns} />

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
    </Card>
  );
}
