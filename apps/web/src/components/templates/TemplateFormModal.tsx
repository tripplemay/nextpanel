'use client';

import { useEffect } from 'react';
import { Modal, Form, Input, Select, App } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { templatesApi } from '@/lib/api';
import type { Template, CreateTemplateDto } from '@/types/api';

const PROTOCOL_OPTIONS = [
  { value: 'VMESS', label: 'VMess' },
  { value: 'VLESS', label: 'VLESS' },
  { value: 'TROJAN', label: 'Trojan' },
  { value: 'SHADOWSOCKS', label: 'Shadowsocks' },
  { value: 'SOCKS5', label: 'SOCKS5' },
  { value: 'HTTP', label: 'HTTP' },
];

const IMPLEMENTATION_OPTIONS = [
  { value: 'XRAY', label: 'Xray' },
  { value: 'V2RAY', label: 'V2Ray' },
  { value: 'SING_BOX', label: 'sing-box' },
  { value: 'SS_LIBEV', label: 'ss-libev' },
];

interface TemplateFormModalProps {
  open: boolean;
  initialValues: Template | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TemplateFormModal({
  open,
  initialValues,
  onClose,
  onSuccess,
}: TemplateFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateTemplateDto & { variablesRaw?: string }>();
  const isEdit = !!initialValues;

  useEffect(() => {
    if (open) {
      if (initialValues) {
        form.setFieldsValue({
          name: initialValues.name,
          protocol: initialValues.protocol,
          implementation: initialValues.implementation ?? undefined,
          content: initialValues.content,
          variablesRaw: initialValues.variables?.join(', '),
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, initialValues, form]);

  const createMutation = useMutation({
    mutationFn: (data: CreateTemplateDto) => templatesApi.create(data),
    onSuccess: () => { message.success('模板已创建'); onSuccess(); },
    onError: () => message.error('创建失败'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateTemplateDto>) =>
      templatesApi.update(initialValues!.id, data),
    onSuccess: () => { message.success('模板已更新'); onSuccess(); },
    onError: () => message.error('更新失败'),
  });

  async function handleSubmit() {
    const values = await form.validateFields();
    const variables = values.variablesRaw
      ? values.variablesRaw.split(',').map((v: string) => v.trim()).filter(Boolean)
      : [];
    const payload: CreateTemplateDto = {
      name: values.name,
      protocol: values.protocol,
      implementation: values.implementation,
      content: values.content,
      variables,
    };
    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑模板' : '新增模板'}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={isEdit ? '保存' : '创建'}
      confirmLoading={isPending}
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label="模板名称" rules={[{ required: true, message: '请输入模板名称' }]}>
          <Input placeholder="e.g. VMess WS TLS" />
        </Form.Item>

        <Form.Item name="protocol" label="协议" rules={[{ required: true, message: '请选择协议' }]}>
          <Select options={PROTOCOL_OPTIONS} placeholder="选择协议" />
        </Form.Item>

        <Form.Item name="implementation" label="实现">
          <Select options={IMPLEMENTATION_OPTIONS} placeholder="选择实现（可选）" allowClear />
        </Form.Item>

        <Form.Item
          name="content"
          label="模板内容"
          rules={[{ required: true, message: '请输入模板内容' }]}
          help="支持 {{variable}} 占位符"
        >
          <Input.TextArea
            rows={8}
            placeholder='{"inbounds": [{"port": {{port}}, ...}]}'
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>

        <Form.Item
          name="variablesRaw"
          label="变量列表"
          help="用逗号分隔，e.g. port, uuid, password"
        >
          <Input placeholder="port, uuid, password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
