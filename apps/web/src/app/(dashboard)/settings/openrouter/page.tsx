'use client';

import { useEffect, useState } from 'react';
import { App, Alert, AutoComplete, Button, Card, Form, Input, Select, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { openRouterApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import { AI_PROVIDER_PRESETS, detectPreset } from '@/lib/ai-providers';
import type { UpsertOpenRouterSettingDto } from '@/types/api';

const { Text } = Typography;

function formatPrice(prompt: string, completion: string): string {
  const p = parseFloat(prompt) * 1_000_000;
  const c = parseFloat(completion) * 1_000_000;
  if (p === 0 && c === 0) return '免费';
  return `$${p.toFixed(2)} / $${c.toFixed(2)} per 1M tokens`;
}

interface FormValues extends UpsertOpenRouterSettingDto {
  providerId: string;
}

export default function OpenRouterSettingsPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [providerId, setProviderId] = useState<string>(AI_PROVIDER_PRESETS[0].id);

  const { data: setting } = useQuery({
    queryKey: ['openrouter-settings'],
    queryFn: () => openRouterApi.getSettings().then((r) => r.data),
  });

  const { data: models, isLoading: modelsLoading, isError: modelsError } = useQuery({
    queryKey: ['openrouter-models', setting?.baseURL],
    queryFn: () => openRouterApi.listModels().then((r) => r.data),
    enabled: !!setting,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  // Restore form state from saved setting
  useEffect(() => {
    if (setting) {
      const preset = detectPreset(setting.baseURL);
      setProviderId(preset.id);
      form.setFieldsValue({
        providerId: preset.id,
        baseURL: setting.baseURL,
        model: setting.model,
        apiKey: '',
      });
    }
  }, [setting, form]);

  function handleProviderChange(newId: string) {
    setProviderId(newId);
    const preset = AI_PROVIDER_PRESETS.find((p) => p.id === newId);
    if (!preset) return;
    // Update baseURL & model unless 自定义 (empty values)
    form.setFieldsValue({
      providerId: newId,
      baseURL: preset.baseURL,
      model: preset.defaultModel,
    });
    setTestResult(null);
  }

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const { providerId: _ignored, ...payload } = values;
      return openRouterApi.upsertSettings(payload);
    },
    onSuccess: () => {
      message.success('AI Provider 配置已保存');
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
      message.success('AI Provider 配置已删除');
      form.resetFields();
      setProviderId(AI_PROVIDER_PRESETS[0].id);
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
      title: '确认删除 AI Provider 配置？',
      content: '删除后将无法使用 AI 自动识别服务商信息。',
      okText: '删除',
      okType: 'danger',
      onOk: () => removeMutation.mutate(),
    });
  }

  const isCustom = providerId === 'custom';
  const modelOptions = (models ?? []).map((m) => ({
    value: m.id,
    label: (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{m.name}</span>
        <Text type="secondary" style={{ fontSize: 11 }}>{formatPrice(m.promptPrice, m.completionPrice)}</Text>
      </div>
    ),
  }));

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="AI Provider" />

      {/* 配置状态 */}
      <div style={{ marginBottom: 16 }}>
        {setting ? (
          <Space>
            <Tag color="green" icon={<CheckCircleOutlined />}>已配置</Tag>
            <Text type="secondary">当前提供商:{detectPreset(setting.baseURL).label}</Text>
            <Text type="secondary">模型:{setting.model}</Text>
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
            <div>用于服务器推荐功能中的 AI 自动识别(从 URL 提取服务商名称、价格、地区)。</div>
            <div>支持任意 OpenAI 兼容的 API 端点(OpenRouter、OpenAI、DeepSeek、MiniMax、Kimi、智谱、通义,或自托管 LLM)。</div>
          </div>
        }
      />

      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 640 }}
        initialValues={{
          providerId: AI_PROVIDER_PRESETS[0].id,
          baseURL: AI_PROVIDER_PRESETS[0].baseURL,
          model: AI_PROVIDER_PRESETS[0].defaultModel,
        }}
      >
        <Form.Item name="providerId" label="提供商" rules={[{ required: true }]}>
          <Select
            options={AI_PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            onChange={handleProviderChange}
          />
        </Form.Item>

        <Form.Item
          name="baseURL"
          label="Base URL"
          rules={[
            { required: true, message: '请输入 Base URL' },
            {
              pattern: /^https?:\/\/.+/i,
              message: 'URL 必须以 http:// 或 https:// 开头',
            },
          ]}
          extra={isCustom ? '可填写任意 OpenAI 兼容端点,例如 http://localhost:11434/v1' : '由提供商预设填充'}
        >
          <Input readOnly={!isCustom} placeholder="https://..." />
        </Form.Item>

        <Form.Item
          name="apiKey"
          label="API Key"
          rules={setting ? [] : [{ required: true, message: '请输入 API Key' }]}
          extra={setting ? '留空保持不变' : ''}
        >
          <Input.Password placeholder="sk-..." />
        </Form.Item>

        <Form.Item
          name="model"
          label="模型"
          rules={[{ required: true, message: '请输入模型名称' }]}
          extra={modelsError ? '该提供商不支持自动列出模型,请手填模型名' : undefined}
        >
          <AutoComplete
            options={modelOptions}
            placeholder="例如:MiniMax-Text-01 / deepseek-chat / gpt-4o-mini"
            filterOption={(input, option) => {
              const v = (option?.value as string) ?? '';
              return v.toLowerCase().includes(input.toLowerCase());
            }}
            disabled={modelsLoading}
            allowClear
          />
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
