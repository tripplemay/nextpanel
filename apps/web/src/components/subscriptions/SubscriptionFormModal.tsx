'use client';

import { useEffect } from 'react';
import { Modal, Form, Input, Select, App } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { subscriptionsApi, nodesApi } from '@/lib/api';
import type { CreateSubscriptionDto, Node } from '@/types/api';

interface SubscriptionFormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SubscriptionFormModal({
  open,
  onClose,
  onSuccess,
}: SubscriptionFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateSubscriptionDto>();

  const { data: nodes, isLoading: nodesLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then((r) => r.data),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  const createMutation = useMutation({
    mutationFn: (data: CreateSubscriptionDto) => subscriptionsApi.create(data),
    onSuccess: () => { message.success('订阅已创建'); onSuccess(); },
    onError: () => message.error('创建失败'),
  });

  async function handleSubmit() {
    const values = await form.validateFields();
    createMutation.mutate(values);
  }

  const nodeOptions = (nodes ?? [])
    .filter((n: Node) => n.enabled && n.status === 'RUNNING')
    .map((n: Node) => ({
      value: n.id,
      label: `${n.name} (${n.protocol}:${n.listenPort})`,
    }));

  return (
    <Modal
      open={open}
      title="新增订阅"
      onCancel={onClose}
      onOk={handleSubmit}
      okText="创建"
      confirmLoading={createMutation.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="订阅名称" rules={[{ required: true, message: '请输入订阅名称' }]}>
          <Input placeholder="e.g. 我的订阅" />
        </Form.Item>

        <Form.Item
          name="nodeIds"
          label="包含节点"
          rules={[{ required: true, message: '请至少选择一个节点' }]}
          help="仅显示运行中的已启用节点"
        >
          <Select
            mode="multiple"
            placeholder="选择节点"
            loading={nodesLoading}
            options={nodeOptions}
            filterOption={(input, option) =>
              (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
