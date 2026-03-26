'use client';

import { useEffect } from 'react';
import { App, Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { openRouterApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import type { UpsertOpenRouterSettingDto } from '@/types/api';

const { Text } = Typography;

export default function OpenRouterSettingsPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<UpsertOpenRouterSettingDto>();

  const { data: setting } = useQuery({
    queryKey: ['openrouter-settings'],
    queryFn: () => openRouterApi.getSettings().then((r) => r.data),
  });

  useEffect(() => {
    if (setting) {
      form.setFieldsValue({
        model: setting.model,
        apiKey: '',
      });
    }
  }, [setting, form]);

  const saveMutation = useMutation({
    mutationFn: (values: UpsertOpenRouterSettingDto) => openRouterApi.upsertSettings(values),
    onSuccess: () => {
      message.success('OpenRouter 配置已保存');
      qc.invalidateQueries({ queryKey: ['openrouter-settings'] });
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      message.error(Array.isArray(msg) ? msg[0] : msg ?? '保存失败');
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => openRouterApi.removeSettings(),
    onSuccess: () => {
      message.success('OpenRouter 配置已删除');
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['openrouter-settings'] });
    },
    onError: () => message.error('删除失败'),
  });

  function handleSave() {
    form.validateFields().then((values) => {
      if (setting && !values.apiKey) {
        message.warning('更新配置时需要重新输入 API Key');
        return;
      }
      saveMutation.mutate(values);
    });
  }

  function handleRemove() {
    modal.confirm({
      title: '确认删除 OpenRouter 配置？',
      content: '删除后将无法使用 AI 自动识别服务商信息。',
      okText: '删除',
      okType: 'danger',
      onOk: () => removeMutation.mutate(),
    });
  }

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="OpenRouter" />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
        message="配置说明"
        description={
          <div>
            <div>OpenRouter 用于服务器推荐功能中的 AI 自动识别。</div>
            <div>配置 API Key 后，添加服务商时可通过 URL 自动提取名称、价格和地区信息。</div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">
                前往{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                  openrouter.ai/keys
                </a>{' '}
                获取 API Key
              </Text>
            </div>
          </div>
        }
      />

      <Form form={form} layout="vertical" style={{ maxWidth: 480 }}>
        <Form.Item
          name="apiKey"
          label="API Key"
          rules={setting ? [] : [{ required: true, message: '请输入 API Key' }]}
          extra={setting ? '留空保持不变' : ''}
        >
          <Input.Password placeholder="sk-or-..." />
        </Form.Item>

        <Form.Item
          name="model"
          label="模型"
          initialValue="anthropic/claude-sonnet-4"
        >
          <Input placeholder="anthropic/claude-sonnet-4" />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" onClick={handleSave} loading={saveMutation.isPending}>
              保存
            </Button>
            {setting && (
              <Button danger icon={<DeleteOutlined />} onClick={handleRemove} loading={removeMutation.isPending}>
                删除配置
              </Button>
            )}
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
