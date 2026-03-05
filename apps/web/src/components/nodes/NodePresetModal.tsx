'use client';

import { useEffect, useState } from 'react';
import { App, Modal, Form, Input, Select } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';
import type { Node } from '@/types/api';
import type { AxiosError } from 'axios';

const { Option } = Select;

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (node: Node) => void;
}

export default function NodePresetModal({ open, onClose, onSuccess }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [serverId, setServerId] = useState<string | undefined>(undefined);

  const { data: presets } = useQuery({
    queryKey: ['node-presets'],
    queryFn: () => nodesApi.listPresets().then((r) => r.data),
    staleTime: Infinity, // presets never change at runtime
  });

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as { id: string; name: string }[]),
    enabled: open,
  });

  const { data: serverNodes } = useQuery({
    queryKey: ['nodes', serverId],
    queryFn: () => nodesApi.list(serverId).then((r) => r.data),
    enabled: open && !!serverId,
  });

  // 根据服务器名和已有节点序号自动生成节点名称
  useEffect(() => {
    if (!serverId || !servers || serverNodes === undefined) return;
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;

    const escaped = server.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}-(\\d+)$`);
    const usedNumbers = new Set<number>();
    for (const node of serverNodes) {
      const match = node.name.match(pattern);
      if (match) usedNumbers.add(Number(match[1]));
    }
    let n = 1;
    while (usedNumbers.has(n)) n++;
    form.setFieldsValue({ name: `${server.name}-${n}` });
  }, [serverId, servers, serverNodes, form]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setServerId(undefined);
    }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (values: { serverId: string; preset: string; name: string }) =>
      nodesApi.createFromPreset(values),
    onSuccess: (res) => {
      onSuccess(res.data);
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
        onValuesChange={(changed) => {
          if ('serverId' in changed) setServerId(changed.serverId as string | undefined);
        }}
      >
        <Form.Item name="serverId" label="服务器" rules={[{ required: true, message: '请选择服务器' }]}>
          <Select placeholder="选择服务器">
            {servers?.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item name="preset" label="协议预设" rules={[{ required: true, message: '请选择协议预设' }]}>
          <Select placeholder="选择协议预设">
            {presets?.map((p) => <Option key={p.value} value={p.value}>{p.label}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item
          name="name"
          label="节点名称"
          rules={[{ required: true, message: '请输入节点名称' }]}
        >
          <Input placeholder="选择服务器后自动生成" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
