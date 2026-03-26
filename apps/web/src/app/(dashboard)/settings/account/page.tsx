'use client';

import { App, Button, Card, Form, Input, Space, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, wxWorkApi } from '@/lib/api';
import { useIsMobile } from '@/hooks/useIsMobile';
import PageHeader from '@/components/common/PageHeader';
import type { AxiosError } from 'axios';

const { Text } = Typography;

export default function AccountSettingsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { isMobile } = useIsMobile();
  const [form] = Form.useForm();

  const mutation = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => {
      message.success('密码已修改');
      form.resetFields();
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ message: string | string[] }>;
      const msgs = axiosErr.response?.data?.message;
      const text = Array.isArray(msgs) ? msgs[0] : typeof msgs === 'string' ? msgs : '修改失败';
      message.error(text);
    },
  });

  // WeChat Work bind status
  const { data: wxConfig } = useQuery({
    queryKey: ['wxwork-configured'],
    queryFn: () => wxWorkApi.configured().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: bindStatus } = useQuery({
    queryKey: ['wxwork-bind-status'],
    queryFn: () => wxWorkApi.bindStatus().then((r) => r.data),
    enabled: !!wxConfig?.configured,
  });

  const unbindMutation = useMutation({
    mutationFn: () => wxWorkApi.unbind(),
    onSuccess: () => {
      message.success('已解除企业微信绑定');
      qc.invalidateQueries({ queryKey: ['wxwork-bind-status'] });
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ message: string | string[] }>;
      const msg = axiosErr.response?.data?.message;
      message.error(Array.isArray(msg) ? msg[0] : msg ?? '解绑失败');
    },
  });

  async function handleBind() {
    try {
      const device = isMobile ? 'mobile' : 'desktop';
      const res = await wxWorkApi.loginUrl(device, `${window.location.origin}/wxwork/bind-callback`);
      window.location.href = res.data.url;
    } catch {
      message.error('获取企业微信授权链接失败');
    }
  }

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="账户安全" />

      <Card title="修改密码" size="small" style={{ maxWidth: 400 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) =>
            mutation.mutate(v as { currentPassword: string; newPassword: string })
          }
        >
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少 6 位' },
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            修改密码
          </Button>
        </Form>
      </Card>

      {wxConfig?.configured && (
        <Card title="企业微信绑定" size="small" style={{ maxWidth: 400, marginTop: 16 }}>
          {bindStatus?.bound ? (
            <Space direction="vertical" size={12}>
              <div>
                <Text type="secondary">已绑定：</Text>
                <Tag color="green" style={{ marginLeft: 8 }}>{bindStatus.wxWorkName}</Tag>
              </div>
              <Button
                danger
                onClick={() => unbindMutation.mutate()}
                loading={unbindMutation.isPending}
              >
                解除绑定
              </Button>
            </Space>
          ) : (
            <Space direction="vertical" size={12}>
              <Text type="secondary">绑定后可使用企业微信扫码登录此账号</Text>
              <Button
                onClick={handleBind}
                style={{ background: '#07c160', borderColor: '#07c160', color: '#fff' }}
              >
                绑定企业微信
              </Button>
            </Space>
          )}
        </Card>
      )}
    </Card>
  );
}
