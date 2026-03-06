'use client';

import { useState } from 'react';
import {
  App, Card, Table, Tag, Button, Modal, Form, InputNumber, Space,
  Popconfirm, Typography, Input,
} from 'antd';
import { PlusOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inviteCodesApi } from '@/lib/api';
import type { InviteCode } from '@/types/api';
import PageHeader from '@/components/common/PageHeader';

const { Text } = Typography;

export default function InviteCodesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<InviteCode[]>([]);
  const [form] = Form.useForm();

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ['invite-codes'],
    queryFn: () => inviteCodesApi.list().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: ({ quantity, maxUses }: { quantity: number; maxUses: number }) =>
      inviteCodesApi.create(quantity, maxUses).then((r) => r.data),
    onSuccess: (newCodes) => {
      queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
      setCreateModalOpen(false);
      setGeneratedCodes(newCodes);
      setResultModalOpen(true);
      form.resetFields();
    },
    onError: () => message.error('生成失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => inviteCodesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
      message.success('邀请码已删除');
    },
    onError: () => message.error('删除失败'),
  });

  function copyAll() {
    const text = generatedCodes.map((c) => c.code).join('\n');
    navigator.clipboard.writeText(text).then(() => message.success('已复制全部邀请码'));
  }

  const columns = [
    {
      title: '邀请码',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => <Text code copyable>{code}</Text>,
    },
    {
      title: '使用情况',
      key: 'usage',
      width: 120,
      render: (_: unknown, record: InviteCode) => {
        const exhausted = record.usedCount >= record.maxUses;
        return (
          <Tag color={exhausted ? 'default' : 'green'}>
            {record.usedCount} / {record.maxUses}
          </Tag>
        );
      },
    },
    {
      title: '创建者',
      key: 'creator',
      width: 100,
      render: (_: unknown, record: InviteCode) => record.creator?.username ?? '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: InviteCode) => (
        <Popconfirm
          title="确认删除该邀请码？"
          onConfirm={() => deleteMutation.mutate(record.id)}
          okText="删除"
          okType="danger"
          cancelText="取消"
        >
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="邀请码管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            生成邀请码
          </Button>
        }
      />
      <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table
          size="middle"
          rowKey="id"
          loading={isLoading}
          dataSource={codes}
          columns={columns}
          pagination={{ showTotal: (total) => `共 ${total} 条` }}
        />
      </Card>

      {/* 创建邀请码 Modal */}
      <Modal
        title="生成邀请码"
        open={createModalOpen}
        onCancel={() => { setCreateModalOpen(false); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
        okText="生成"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ quantity: 1, maxUses: 1 }}
          onFinish={(values) => createMutation.mutate(values)}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="quantity"
            label="生成数量（个）"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="maxUses"
            label="每码可用次数（次）"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 生成结果 Modal */}
      <Modal
        title={`已生成 ${generatedCodes.length} 个邀请码`}
        open={resultModalOpen}
        onCancel={() => setResultModalOpen(false)}
        footer={
          <Space>
            <Button icon={<CopyOutlined />} onClick={copyAll}>一键复制全部</Button>
            <Button type="primary" onClick={() => setResultModalOpen(false)}>关闭</Button>
          </Space>
        }
        width={480}
      >
        <Input.TextArea
          value={generatedCodes.map((c) => c.code).join('\n')}
          readOnly
          autoSize={{ minRows: 3, maxRows: 10 }}
          style={{ fontFamily: 'monospace', marginTop: 8 }}
        />
      </Modal>
    </>
  );
}
