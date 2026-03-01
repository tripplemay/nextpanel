'use client';

import { useState } from 'react';
import { App, Card, Table, Tag, Space, Popconfirm } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { templatesApi } from '@/lib/api';
import TemplateFormModal from '@/components/templates/TemplateFormModal';
import PageHeader from '@/components/common/PageHeader';
import type { Template } from '@/types/api';
import type { ColumnType } from 'antd/es/table';
import { Button } from 'antd';

export default function TemplatesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Template | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list().then((r) => r.data),
  });
  if (isError) message.error('加载模板失败');

  const deleteMutation = useMutation({
    mutationFn: (id: string) => templatesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      message.success('模板已删除');
    },
    onError: () => message.error('删除失败'),
  });

  function openCreate() {
    setEditTarget(null);
    setModalOpen(true);
  }

  function openEdit(record: Template) {
    setEditTarget(record);
    setModalOpen(true);
  }

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
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '操作',
      render: (_: unknown, record) => (
        <Space>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm
            title="确认删除该模板？"
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
      <PageHeader title="配置模板" addLabel="新增模板" onAdd={openCreate} />
      <Table rowKey="id" size="middle" loading={isLoading} dataSource={data} columns={columns} pagination={{ showTotal: (total) => `共 ${total} 条` }} />

      <TemplateFormModal
        open={modalOpen}
        initialValues={editTarget}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setModalOpen(false);
          qc.invalidateQueries({ queryKey: ['templates'] });
        }}
      />
    </Card>
  );
}
