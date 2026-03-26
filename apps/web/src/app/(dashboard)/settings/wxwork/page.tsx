'use client';

import { useEffect } from 'react';
import { App, Button, Card, Form, Input, Space, Typography, Alert } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { wxWorkApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import type { UpsertWxWorkSettingDto } from '@/types/api';

const { Text } = Typography;

export default function WxWorkSettingsPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm<UpsertWxWorkSettingDto>();

  const { data: setting } = useQuery({
    queryKey: ['wxwork-settings'],
    queryFn: () => wxWorkApi.getSettings().then((r) => r.data),
  });

  useEffect(() => {
    if (setting) {
      form.setFieldsValue({
        corpId: setting.corpId,
        agentId: setting.agentId,
        secret: '',
        proxyUrl: setting.proxyUrl ?? '',
      });
    }
  }, [setting, form]);

  const saveMutation = useMutation({
    mutationFn: (values: UpsertWxWorkSettingDto) => wxWorkApi.upsertSettings(values),
    onSuccess: () => {
      message.success('企业微信配置已保存');
      qc.invalidateQueries({ queryKey: ['wxwork-settings'] });
      qc.invalidateQueries({ queryKey: ['wxwork-configured'] });
    },
    onError: (err: { response?: { data?: { message?: string | string[] } } }) => {
      const msg = err.response?.data?.message;
      message.error(Array.isArray(msg) ? msg[0] : msg ?? '保存失败');
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => wxWorkApi.removeSettings(),
    onSuccess: () => {
      message.success('企业微信配置已删除');
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['wxwork-settings'] });
      qc.invalidateQueries({ queryKey: ['wxwork-configured'] });
    },
    onError: () => message.error('删除失败'),
  });

  function handleSave() {
    form.validateFields().then((values) => {
      if (setting && !values.secret) {
        message.warning('更新配置时需要重新输入应用密钥');
        return;
      }
      saveMutation.mutate(values);
    });
  }

  function handleRemove() {
    modal.confirm({
      title: '确认删除企业微信配置？',
      content: '删除后企业微信登录将不可用，已绑定的用户仍可使用密码登录。',
      okText: '删除',
      okType: 'danger',
      onOk: () => removeMutation.mutate(),
    });
  }

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="企业微信" />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
        message="配置说明"
        description={
          <div>
            <div>1. 登录企业微信管理后台，创建一个自建应用</div>
            <div>2. 在应用详情页获取 AgentId 和 Secret</div>
            <div>3. 在企业信息页获取企业 ID（CorpId）</div>
            <div>4. 在应用的"网页授权及 JS-SDK"中添加可信域名</div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">使用企业微信登录需要绑定域名并启用 HTTPS</Text>
            </div>
          </div>
        }
      />

      <Form form={form} layout="vertical" style={{ maxWidth: 480 }}>
        <Form.Item
          name="corpId"
          label="企业 ID（CorpId）"
          rules={[{ required: true, message: '请输入企业 ID' }]}
        >
          <Input placeholder="wxxxxxxxxxxxxxxxxx" />
        </Form.Item>

        <Form.Item
          name="agentId"
          label="应用 ID（AgentId）"
          rules={[{ required: true, message: '请输入应用 ID' }]}
        >
          <Input placeholder="1000002" />
        </Form.Item>

        <Form.Item
          name="secret"
          label="应用密钥（Secret）"
          rules={setting ? [] : [{ required: true, message: '请输入应用密钥' }]}
          extra={setting ? '留空保持不变' : ''}
        >
          <Input.Password placeholder="应用密钥" />
        </Form.Item>

        <Form.Item
          name="proxyUrl"
          label="API 代理（可选）"
          extra="海外服务器无法访问微信 API 时使用，如 http://proxy:7890"
        >
          <Input placeholder="http://proxy.example.com:7890" />
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
