'use client';

import { useEffect, useState } from 'react';
import {
  App,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Spin,
} from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '@/lib/api';
import type { CreateServerDto, UpdateServerDto, Server } from '@/types/api';

const { Option } = Select;
const { TextArea } = Input;

interface GeoResult {
  country_name?: string;
  country_code?: string;
  city?: string;
  org?: string;
}

async function fetchGeoIp(ip: string): Promise<GeoResult | null> {
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!res.ok) return null;
    return await res.json() as GeoResult;
  } catch {
    return null;
  }
}

interface Props {
  open: boolean;
  initialValues: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: (server?: Server, templateIds?: string[]) => void;
}

export default function ServerFormModal({
  open,
  initialValues,
  onClose,
  onSuccess,
}: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const isEdit = !!initialValues?.id;
  const [geoLoading, setGeoLoading] = useState(false);
  const [ipError, setIpError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setIpError(undefined);
      if (initialValues) {
        form.setFieldsValue({
          ...initialValues,
          tags: (initialValues.tags as string[]) ?? [],
        });
      }
    }
  }, [open, initialValues, form]);

  const handleIpBlur = async () => {
    const ip = (form.getFieldValue('ip') as string)?.trim();
    if (!ip) return;

    // IP 重复检测
    try {
      const res = await serversApi.checkIp(ip);
      if (res.data.exists) {
        if (!isEdit || initialValues?.ip !== ip) {
          setIpError('该 IP 已存在，请勿重复添加');
          return;
        }
      }
    } catch {
      // 检测失败不阻断，继续
    }
    setIpError(undefined);

    // 仅新增时自动填充名称、区域和提供商
    if (isEdit) return;
    const region = form.getFieldValue('region') as string;
    const provider = form.getFieldValue('provider') as string;
    if (region && provider) return; // 已有值，不覆盖

    setGeoLoading(true);
    const geo = await fetchGeoIp(ip);
    setGeoLoading(false);
    if (!geo) return;

    const updates: Record<string, string> = {};
    if (!region && geo.country_code) {
      updates.region = geo.country_code.toUpperCase();
    }
    if (!provider && geo.org) {
      updates.provider = geo.org.replace(/^AS\d+\s+/, '');
    }
    // 名称自动填充为完整地名（仅当名称为空时），冲突时自动加后缀
    const name = form.getFieldValue('name') as string;
    if (!name && geo.country_name) {
      const base = geo.city ? `${geo.country_name} · ${geo.city}` : geo.country_name;
      const existingNames = new Set(
        (qc.getQueryData<{ name: string }[]>(['servers']) ?? []).map((s) => s.name),
      );
      let candidate = base;
      let i = 2;
      while (existingNames.has(candidate)) {
        candidate = `${base}-${i++}`;
      }
      updates.name = candidate;
    }
    if (Object.keys(updates).length > 0) {
      setTimeout(() => form.setFieldsValue(updates), 0);
    }
  };

  const mutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload = {
        ...values,
        tags: Array.isArray(values.tags) ? values.tags : [],
      };
      if (isEdit) {
        return serversApi.update(initialValues!.id as string, payload as UpdateServerDto);
      }
      return serversApi.create(payload as CreateServerDto);
    },
    onSuccess: (res) => {
      message.success(isEdit ? '服务器已更新' : '服务器已添加');
      onSuccess(res.data as Server, []);
    },
    onError: () => message.error('操作失败'),
  });

  const handleOk = () => {
    if (ipError) return;
    void form.submit();
  };

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑服务器' : '新增服务器'}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={mutation.isPending}
      width={560}
    >
      <Spin spinning={geoLoading} tip="正在查询 IP 归属地...">
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => mutation.mutate(v as Record<string, unknown>)}
          initialValues={{ sshPort: 22, sshUser: 'root', sshAuthType: 'KEY' }}
        >
          <Form.Item
            name="ip"
            label="IP 地址"
            rules={[{ required: true }]}
            validateStatus={ipError ? 'error' : undefined}
            help={ipError}
          >
            <Input onBlur={handleIpBlur} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="填写 IP 后自动识别，可手动修改" />
          </Form.Item>
          <Form.Item name="region" label="区域" rules={[{ required: true }]}>
            <Input placeholder="填写 IP 后自动识别，可手动修改" />
          </Form.Item>
          <Form.Item name="provider" label="提供商" rules={[{ required: true }]}>
            <Input placeholder="填写 IP 后自动识别，可手动修改" />
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
            <Select mode="tags" placeholder="输入后按回车添加标签" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
