'use client';

import { useEffect } from 'react';
import { App, Modal, Form, Input, Select, InputNumber } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';

const { Option } = Select;

interface Props {
  open: boolean;
  initialValues: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function NodeFormModal({ open, initialValues, onClose, onSuccess }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = !!initialValues?.id;

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as { id: string; name: string }[]),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      form.resetFields();
      if (initialValues) form.setFieldsValue(initialValues);
    }
  }, [open, initialValues, form]);

  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const { uuid, password, method, ...rest } = values;
      const payload = {
        ...rest,
        credentials: { uuid, password, method },
      };
      return isEdit
        ? nodesApi.update(initialValues!.id as string, payload)
        : nodesApi.create(payload);
    },
    onSuccess: () => {
      message.success(isEdit ? '节点已更新' : '节点已创建');
      onSuccess();
    },
    onError: () => message.error('操作失败'),
  });

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑节点' : '新增节点'}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mutation.mutate(v as Record<string, unknown>)}
        initialValues={{ tls: 'NONE', implementation: 'XRAY', transport: 'TCP' }}
      >
        <Form.Item name="serverId" label="服务器" rules={[{ required: true }]}>
          <Select placeholder="选择服务器">
            {servers?.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="name" label="节点名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
          <Select>
            {['VMESS', 'VLESS', 'TROJAN', 'SHADOWSOCKS', 'SOCKS5', 'HTTP'].map((p) => (
              <Option key={p} value={p}>{p}</Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="implementation" label="实现">
          <Select allowClear>
            {['XRAY', 'V2RAY', 'SING_BOX', 'SS_LIBEV'].map((i) => (
              <Option key={i} value={i}>{i}</Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="transport" label="传输">
          <Select allowClear>
            {['TCP', 'WS', 'GRPC', 'QUIC'].map((t) => <Option key={t} value={t}>{t}</Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="tls" label="TLS">
          <Select>
            {['NONE', 'TLS', 'REALITY'].map((t) => <Option key={t} value={t}>{t}</Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="listenPort" label="监听端口" rules={[{ required: true }]}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="domain" label="域名">
          <Input placeholder="可选" />
        </Form.Item>
        <Form.Item name="uuid" label="UUID（VMess/VLESS）">
          <Input placeholder="留空自动生成" />
        </Form.Item>
        <Form.Item name="password" label="密码（Trojan/SS）">
          <Input.Password />
        </Form.Item>
        <Form.Item name="method" label="加密方式（Shadowsocks）">
          <Input placeholder="如：aes-256-gcm" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
