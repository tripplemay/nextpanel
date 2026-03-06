'use client';

import { useEffect } from 'react';
import { Modal, Form, Input, Select, App, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { subscriptionsApi, nodesApi } from '@/lib/api';
import type { CreateSubscriptionDto, Subscription, Node } from '@/types/api';

const STATUS_COLOR: Record<string, string> = {
  RUNNING: 'green',
  STOPPED: 'orange',
  ERROR: 'red',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** When provided, the modal operates in edit mode */
  subscription?: Subscription | null;
}

export default function SubscriptionFormModal({
  open,
  onClose,
  onSuccess,
  subscription,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateSubscriptionDto>();
  const isEdit = !!subscription;

  const { data: nodes, isLoading: nodesLoading } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then((r) => r.data),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      if (isEdit && subscription) {
        form.setFieldsValue({
          name: subscription.name,
          nodeIds: subscription.nodes.map((sn) => sn.node.id),
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, isEdit, subscription, form]);

  const createMutation = useMutation({
    mutationFn: (data: CreateSubscriptionDto) => subscriptionsApi.create(data),
    onSuccess: () => { message.success('订阅已创建'); onSuccess(); },
    onError: () => message.error('创建失败'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: CreateSubscriptionDto) =>
      subscriptionsApi.update(subscription!.id, data),
    onSuccess: () => { message.success('订阅已更新'); onSuccess(); },
    onError: () => message.error('更新失败'),
  });

  async function handleSubmit() {
    const values = await form.validateFields();
    if (isEdit) {
      updateMutation.mutate(values);
    } else {
      createMutation.mutate(values);
    }
  }

  const nodeOptions = (nodes ?? []).map((n: Node) => ({
    value: n.id,
    label: (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {n.name}
        <span style={{ color: '#8c8c8c', fontSize: 12 }}>({n.protocol}:{n.listenPort})</span>
        <Tag color={STATUS_COLOR[n.status] ?? 'default'} style={{ margin: 0, fontSize: 11 }}>
          {n.status}
        </Tag>
      </span>
    ),
  }));

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑订阅' : '新增订阅'}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={isEdit ? '保存' : '创建'}
      confirmLoading={isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="订阅名称" rules={[{ required: true, message: '请输入订阅名称' }]}>
          <Input placeholder="e.g. 我的订阅" />
        </Form.Item>

        <Form.Item
          name="nodeIds"
          label="包含节点"
          rules={[{ required: true, message: '请至少选择一个节点' }]}
        >
          <Select
            mode="multiple"
            placeholder="选择节点"
            loading={nodesLoading}
            options={nodeOptions}
            filterOption={(input, option) => {
              const node = (nodes ?? []).find((n: Node) => n.id === option?.value);
              if (!node) return false;
              return (
                node.name.toLowerCase().includes(input.toLowerCase()) ||
                node.protocol.toLowerCase().includes(input.toLowerCase())
              );
            }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
