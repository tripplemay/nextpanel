'use client';

import { useEffect, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Popconfirm,
  Space,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  QuestionCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cloudflareApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import type { AxiosError } from 'axios';

const { Text, Link, Paragraph } = Typography;

interface VerifyResult {
  valid: boolean;
  zoneName?: string;
  zoneStatus?: string;
  message: string;
}

const helpSteps = (
  <Space direction="vertical" size={16} style={{ width: '100%', padding: '4px 0' }}>
    <div>
      <Text strong>1. 创建 API Token</Text>
      <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 4 }}>
        登录 Cloudflare → My Profile → API Tokens → Create Token，选择「Edit zone DNS」模板，
        权限设置为 Zone &gt; DNS &gt; Edit，Zone 范围选择你的域名。
      </Paragraph>
      <Link href="https://dash.cloudflare.com/profile/api-tokens" target="_blank">
        前往创建 API Token →
      </Link>
    </div>
    <div>
      <Text strong>2. 获取 Zone ID</Text>
      <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 4 }}>
        进入 Cloudflare 控制台，选择你的域名，在右侧栏底部可以找到「Zone ID」。
      </Paragraph>
      <Link href="https://dash.cloudflare.com" target="_blank">
        前往 Cloudflare 控制台 →
      </Link>
    </div>
    <div>
      <Text strong>3. 根域名</Text>
      <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
        填写你在 Cloudflare 托管的根域名，例如 <Text code>example.com</Text>，不含{' '}
        <Text code>http://</Text> 或路径。
      </Paragraph>
    </div>
  </Space>
);

export default function CloudflareSettingsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const { data: setting } = useQuery({
    queryKey: ['cloudflare-settings'],
    queryFn: () => cloudflareApi.get().then((r) => r.data),
  });

  useEffect(() => {
    if (setting) {
      form.setFieldsValue({ zoneId: setting.zoneId, domain: setting.domain });
    } else {
      form.resetFields();
    }
    setVerifyResult(null);
  }, [setting, form]);

  const saveMutation = useMutation({
    mutationFn: (values: { apiToken: string; zoneId: string; domain: string }) =>
      cloudflareApi.upsert(values),
    onSuccess: () => {
      message.success('Cloudflare 设置已保存');
      setVerifyResult(null);
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
      setVerifyResult(null);
      qc.invalidateQueries({ queryKey: ['cloudflare-settings'] });
    },
    onError: () => message.error('删除失败'),
  });

  const verifyMutation = useMutation({
    mutationFn: () => cloudflareApi.verify().then((r) => r.data),
    onSuccess: (res) => setVerifyResult(res),
    onError: () => setVerifyResult({ valid: false, message: '请求失败，请检查网络连接' }),
  });

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="Cloudflare DNS" />

      <Card size="small" style={{ maxWidth: 560 }}>
        {/* 帮助折叠 */}
        <Collapse
          ghost
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'help',
              label: (
                <Text type="secondary">
                  <QuestionCircleOutlined style={{ marginRight: 6 }} />
                  如何获取这些参数？
                </Text>
              ),
              children: helpSteps,
            },
          ]}
        />

        {/* 已配置摘要 */}
        {setting && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <Space>
                <Text>当前域名：<Text strong>{setting.domain}</Text></Text>
                {verifyResult?.valid && (
                  <Text type="success">
                    <CheckCircleOutlined style={{ marginRight: 4 }} />已验证
                  </Text>
                )}
              </Space>
            }
          />
        )}

        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          配置后，创建 VLESS+WS+TLS 节点时将自动创建 Cloudflare DNS A 记录。
        </Text>

        <Form
          form={form}
          layout="vertical"
          onFinish={(v) =>
            saveMutation.mutate(v as { apiToken: string; zoneId: string; domain: string })
          }
        >
          <Form.Item
            name="apiToken"
            label="API Token"
            rules={setting ? [] : [{ required: true, message: '请输入 API Token' }]}
          >
            <Input.Password
              placeholder={setting ? '已配置（留空不更改）' : '请输入 Cloudflare API Token'}
            />
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

          <Space>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              保存
            </Button>
            {setting && (
              <Button
                icon={<SyncOutlined />}
                loading={verifyMutation.isPending}
                onClick={() => verifyMutation.mutate()}
              >
                验证配置
              </Button>
            )}
          </Space>
        </Form>

        {/* 验证结果 */}
        {verifyResult && (
          <Alert
            style={{ marginTop: 16 }}
            type={verifyResult.valid ? 'success' : 'error'}
            icon={verifyResult.valid ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            showIcon
            message={verifyResult.valid ? '配置有效' : '配置无效'}
            description={
              verifyResult.valid ? (
                <Space direction="vertical" size={2}>
                  <Text>{verifyResult.message}</Text>
                  {verifyResult.zoneStatus && verifyResult.zoneStatus !== 'active' && (
                    <Text type="warning">
                      域名状态为 {verifyResult.zoneStatus}，DNS 可能尚未完全生效
                    </Text>
                  )}
                </Space>
              ) : (
                <Text>{verifyResult.message}</Text>
              )
            }
          />
        )}

        {/* 删除配置 */}
        {setting && (
          <div style={{ marginTop: 32, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              危险操作
            </Text>
            <Popconfirm
              title="确认删除 Cloudflare 配置？"
              description="删除后，新建 VLESS+WS+TLS 节点时将无法自动创建 DNS 记录。"
              onConfirm={() => removeMutation.mutate()}
              okType="danger"
              okText="删除"
              cancelText="取消"
            >
              <Button danger loading={removeMutation.isPending}>
                删除配置
              </Button>
            </Popconfirm>
          </div>
        )}
      </Card>
    </Card>
  );
}
