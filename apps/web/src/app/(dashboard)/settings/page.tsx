'use client';

import { useEffect } from 'react';
import { App, Button, Card, Form, Input, Popconfirm, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudflareApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import type { AxiosError } from 'axios';

const { Text } = Typography;

export default function SettingsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();

  const { data: setting, isLoading } = useQuery({
    queryKey: ['cloudflare-settings'],
    queryFn: () => cloudflareApi.get().then((r) => r.data),
  });

  useEffect(() => {
    if (setting) {
      form.setFieldsValue({
        zoneId: setting.zoneId,
        domain: setting.domain,
        // apiToken is write-only — leave blank
      });
    } else {
      form.resetFields();
    }
  }, [setting, form]);

  const saveMutation = useMutation({
    mutationFn: (values: { apiToken: string; zoneId: string; domain: string }) =>
      cloudflareApi.upsert(values),
    onSuccess: () => {
      message.success('Cloudflare 设置已保存');
      qc.invalidateQueries({ queryKey: ['cloudflare-settings'] });
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ message: string | string[] }>;
      const msgs = axiosErr.response?.data?.message;
      const text = Array.isArray(msgs) ? msgs[0] : typeof msgs === 'string' ? msgs : '保存失败';
      message.error(text);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => cloudflareApi.remove(),
    onSuccess: () => {
      message.success('Cloudflare 设置已删除');
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['cloudflare-settings'] });
    },
    onError: () => message.error('删除失败'),
  });

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="系统设置" />

      <Card
        title="Cloudflare DNS"
        size="small"
        style={{ maxWidth: 540 }}
        extra={
          setting && (
            <Popconfirm
              title="确认删除 Cloudflare 配置？"
              onConfirm={() => removeMutation.mutate()}
              okType="danger"
              okText="删除"
            >
              <Button size="small" danger loading={removeMutation.isPending}>
                删除配置
              </Button>
            </Popconfirm>
          )
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          配置后，创建 VLESS+WS+TLS 节点时将自动创建 Cloudflare DNS A 记录。
        </Text>

        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => saveMutation.mutate(v as { apiToken: string; zoneId: string; domain: string })}
        >
          <Form.Item
            name="apiToken"
            label="API Token"
            rules={setting ? [] : [{ required: true, message: '请输入 API Token' }]}
          >
            <Input.Password placeholder={setting ? '已配置（留空不更改）' : '请输入 Cloudflare API Token'} />
          </Form.Item>

          <Form.Item
            name="zoneId"
            label="Zone ID"
            rules={[{ required: true, message: '请输入 Zone ID' }]}
          >
            <Input placeholder="Cloudflare Zone ID" />
          </Form.Item>

          <Form.Item
            name="domain"
            label="根域名"
            rules={[{ required: true, message: '请输入根域名' }]}
          >
            <Input placeholder="example.com" />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            保存
          </Button>
        </Form>
      </Card>
    </Card>
  );
}
