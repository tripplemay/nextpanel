'use client';

import { useEffect } from 'react';
import {
  App,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
} from 'antd';
import { useMutation } from '@tanstack/react-query';
import { serversApi } from '@/lib/api';
import type { CreateServerDto, UpdateServerDto } from '@/types/api';

const { Option } = Select;
const { TextArea } = Input;

interface Props {
  open: boolean;
  initialValues: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ServerFormModal({
  open,
  initialValues,
  onClose,
  onSuccess,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = !!initialValues?.id;

  useEffect(() => {
    if (open) {
      form.resetFields();
      if (initialValues) {
        form.setFieldsValue({
          ...initialValues,
          tags: (initialValues.tags as string[])?.join(', '),
        });
      }
    }
  }, [open, initialValues, form]);

  const mutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload = {
        ...values,
        tags: values.tags
          ? String(values.tags).split(',').map((t: string) => t.trim()).filter(Boolean)
          : [],
      };
      if (isEdit) {
        return serversApi.update(initialValues!.id as string, payload as UpdateServerDto);
      }
      return serversApi.create(payload as CreateServerDto);
    },
    onSuccess: () => {
      message.success(isEdit ? '服务器已更新' : '服务器已添加');
      onSuccess();
    },
    onError: () => message.error('操作失败'),
  });

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑服务器' : '新增服务器'}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mutation.mutate(v as Record<string, unknown>)}
        initialValues={{ sshPort: 22, sshUser: 'root', sshAuthType: 'KEY' }}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="ip" label="IP 地址" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="region" label="区域" rules={[{ required: true }]}>
          <Input placeholder="如：HK、JP、US-LA" />
        </Form.Item>
        <Form.Item name="provider" label="提供商" rules={[{ required: true }]}>
          <Input placeholder="如：Vultr、AWS、阿里云" />
        </Form.Item>
        <Form.Item name="sshPort" label="SSH 端口">
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="sshUser" label="SSH 用户名">
          <Input />
        </Form.Item>
        <Form.Item name="sshAuthType" label="认证方式">
          <Select>
            <Option value="KEY">私钥</Option>
            <Option value="PASSWORD">密码</Option>
          </Select>
        </Form.Item>
        <Form.Item
          name="sshAuth"
          label="SSH 凭证"
          rules={isEdit ? [] : [{ required: true }]}
          extra={isEdit ? '留空保持不变' : ''}
        >
          <TextArea rows={4} placeholder="PEM 私钥内容或登录密码" />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Input placeholder="逗号分隔，如：streaming, low-latency" />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
