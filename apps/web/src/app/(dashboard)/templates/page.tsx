'use client';

import { App, Card, Table, Tag, Button, Space, Typography, Popconfirm } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { templatesApi } from '@/lib/api';
import type { ColumnType } from 'antd/es/table';

const { Title } = Typography;

interface Template {
  id: string;
  name: string;
  protocol: string;
  implementation: string | null;
  variables: string[];
  createdAt: string;
  createdBy: { username: string };
}

export default function TemplatesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list().then((r) => r.data as Template[]),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => templatesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      message.success('模板已删除');
    },
  });

  const columns: ColumnType<Template>[] = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '协议',
      render: (_: unknown, r) => (
        <Space>
          <Tag color="blue">{r.protocol}</Tag>
          {r.implementation && <Tag>{r.implementation}</Tag>}
        </Space>
      ),
    },
    {
      title: '变量',
      dataIndex: 'variables',
      render: (vars: string[]) => vars.map((v) => <Tag key={v}>{`{{${v}}}`}</Tag>),
    },
    { title: '创建人', render: (_: unknown, r) => r.createdBy?.username },
    { title: '创建时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作',
      render: (_: unknown, record) => (
        <Popconfirm
          title="确认删除该模板？"
          onConfirm={() => deleteMutation.mutate(record.id)}
          okText="删除"
          okType="danger"
        >
          <Button size="small" danger>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>配置模板</Title>
        <Button type="primary" icon={<PlusOutlined />}>新增模板</Button>
      </div>
      <Table rowKey="id" loading={isLoading} dataSource={data} columns={columns} />
    </Card>
  );
}
