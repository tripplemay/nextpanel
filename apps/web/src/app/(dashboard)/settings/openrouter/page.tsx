'use client';

import { useEffect, useState } from 'react';
import { App, Alert, Button, Card, Form, Input, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { openRouterApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import type { UpsertOpenRouterSettingDto } from '@/types/api';

const { Text } = Typography;

function formatPrice(prompt: string, completion: string): string {
  const p = parseFloat(prompt) * 1_000_000;
  const c = parseFloat(completion) * 1_000_000;
  if (p === 0 && c === 0) return '免费';
  return `$${p.toFixed(2)} / $${c.toFixed(2)} per 1M tokens`;
}

export default function OpenRouterSettingsPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<UpsertOpenRouterSettingDto>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: setting } = useQuery({
    queryKey: ['openrouter-settings'],
    queryFn: () => openRouterApi.getSettings().then((r) => r.data),
  });

  const { data: models, isLoading: modelsLoading } = useQuery({
    queryKey: ['openrouter-models'],
    queryFn: () => openRouterApi.listModels().then((r) => r.data),
    enabled: !!setting,
    staleTime: 10 * 60 * 1000,
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
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ['openrouter-settings'] });
      qc.invalidateQueries({ queryKey: ['openrouter-models'] });
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
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ['openrouter-settings'] });
      qc.invalidateQueries({ queryKey: ['openrouter-models'] });
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

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const model = form.getFieldValue('model') as string;
      const res = await openRouterApi.test(model || undefined);
      setTestResult(res.data);
      if (res.data.success) {
        message.success(res.data.message);
      } else {
        message.error(res.data.message);
      }
    } catch {
      setTestResult({ success: false, message: '测试请求失败' });
      message.error('测试请求失败');
    } finally {
      setTesting(false);
    }
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

  const modelOptions = (models ?? []).map((m) => ({
    value: m.id,
    label: (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{m.name}</span>
        <Text type="secondary" style={{ fontSize: 11 }}>{formatPrice(m.promptPrice, m.completionPrice)}</Text>
      </div>
    ),
    searchText: `${m.name} ${m.id}`,
  }));

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="OpenRouter" />

      {/* 配置状态 */}
      <div style={{ marginBottom: 16 }}>
        {setting ? (
          <Space>
            <Tag color="green" icon={<CheckCircleOutlined />}>已配置</Tag>
            <Text type="secondary">当前模型：{setting.model}</Text>
          </Space>
        ) : (
          <Tag color="default">未配置</Tag>
        )}
        {testResult && (
          <Tag
            color={testResult.success ? 'green' : 'red'}
            icon={testResult.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            style={{ marginLeft: 8 }}
          >
            {testResult.message}
          </Tag>
        )}
      </div>

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

      <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
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
          {setting && models ? (
            <Select
              showSearch
              placeholder="选择模型"
              loading={modelsLoading}
              options={modelOptions}
              filterOption={(input, option) => {
                const text = (option?.searchText as string) ?? '';
                return text.toLowerCase().includes(input.toLowerCase());
              }}
              optionLabelProp="value"
              style={{ width: '100%' }}
            />
          ) : (
            <Input placeholder="anthropic/claude-sonnet-4（保存 API Key 后可选择模型）" />
          )}
        </Form.Item>

        <Form.Item>
          <Space wrap>
            <Button type="primary" onClick={handleSave} loading={saveMutation.isPending}>
              保存
            </Button>
            {setting && (
              <>
                <Button
                  icon={<ApiOutlined />}
                  onClick={handleTest}
                  loading={testing}
                >
                  测试连接
                </Button>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleRemove}
                  loading={removeMutation.isPending}
                >
                  删除配置
                </Button>
              </>
            )}
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}
