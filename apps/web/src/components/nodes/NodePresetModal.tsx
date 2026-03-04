'use client';

import { useEffect } from 'react';
import { App, Modal, Form, Input, Select } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';
import type { AxiosError } from 'axios';

const { Option } = Select;

const PRESETS = [
  { value: 'VLESS_REALITY', label: 'VLESS + REALITY（推荐，隐蔽性强）' },
  { value: 'VLESS_WS_TLS', label: 'VLESS + WS + TLS（CDN 友好）' },
  { value: 'HYSTERIA2',    label: 'Hysteria2（高速 UDP）' },
  { value: 'SHADOWSOCKS',  label: 'Shadowsocks（通用）' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function NodePresetModal({ open, onClose, onSuccess }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as { id: string; name: string }[]),
    enabled: open,
  });

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (values: { serverId: string; preset: string; name: string }) =>
      nodesApi.createFromPreset(values),
    onSuccess: () => {
      message.success('节点已创建，部署中…');
      onSuccess();
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ message: string | string[] }>;
      const msgs = axiosErr.response?.data?.message;
      const text = Array.isArray(msgs) ? msgs[0] : typeof msgs === 'string' ? msgs : '创建失败';
      message.error(text);
    },
  });

  return (
    <Modal
      open={open}
      title="新增节点"
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      width={480}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mutation.mutate(v as { serverId: string; preset: string; name: string })}
      >
        <Form.Item name="serverId" label="服务器" rules={[{ required: true, message: '请选择服务器' }]}>
          <Select placeholder="选择服务器">
            {servers?.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item name="preset" label="协议预设" rules={[{ required: true, message: '请选择协议预设' }]}>
          <Select placeholder="选择协议预设">
            {PRESETS.map((p) => <Option key={p.value} value={p.value}>{p.label}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item
          name="name"
          label="节点名称"
          rules={[{ required: true, message: '请输入节点名称' }]}
        >
          <Input placeholder="自定义名称，例如: HK-01" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
