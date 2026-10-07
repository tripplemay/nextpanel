'use client';

import { App, Button, Card, Form, Input, Space, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, wxWorkApi } from '@/lib/api';
import { useIsMobile } from '@/hooks/useIsMobile';
import PageHeader from '@/components/common/PageHeader';
import AppCard from '@/components/common/AppCard';
import type { AxiosError } from 'axios';
import { useState } from 'react';
import { useAuthStore } from '@/store/auth';

const { Text } = Typography;

export default function AccountSettingsPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { isMobile } = useIsMobile();
  const [form] = Form.useForm();

  const [changingPassword, setChangingPassword] = useState(false);

  async function changePassword(values: { currentPassword: string; newPassword: string }) {
    setChangingPassword(true);
    try {
      await authApi.changePassword(values.currentPassword, values.newPassword);
      message.success('密码已修改，所有旧会话已退出，请重新登录');
      form.resetFields();
      useAuthStore.getState().logout();
      qc.clear();
      window.location.replace('/login');
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string | string[] }>;
      const msgs = axiosErr.response?.data?.message;
      const text = Array.isArray(msgs) ? msgs[0] : typeof msgs === 'string' ? msgs : '修改失败';
      message.error(text);
    } finally { setChangingPassword(false); }
  }

  function revokeOtherSessions() {
    let password = '';
    modal.confirm({
      title: '退出其他设备',
      content: <Input.Password aria-label="确认当前密码" placeholder="请输入当前密码" autoComplete="current-password"
        onChange={event => { password = event.target.value; }} />,
      onCancel: () => { password = ''; },
      onOk: async () => {
        try {
          await authApi.revokeOtherSessions(password);
          password = '';
          message.success('其他旧会话已退出，当前设备保持登录');
        } catch (err) {
          const detail = (err as AxiosError<{ message: string }>).response?.data?.message;
          message.error(typeof detail === 'string' ? detail : '操作失败，请重试或重新登录');
          throw err;
        }
      },
    });
  }

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

  async function startBind(currentPassword: string) {
    try {
      const device = isMobile ? 'mobile' : 'desktop';
      const res = await wxWorkApi.bindUrl(device, currentPassword);
      window.location.href = res.data.url;
    } catch (error) {
      message.error('获取企业微信授权链接失败');
      throw error;
    }
  }

  function handleBind() {
    let password = '';
    modal.confirm({
      title: '绑定前请确认当前账户密码',
      content: <Input.Password autoComplete="current-password" onChange={(event) => { password = event.target.value; }} />,
      onOk: () => startBind(password),
    });
  }

  return (
    <AppCard>
      <PageHeader title="账户安全" />

      <Card title="修改密码" size="small" style={{ maxWidth: 400 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={changePassword}
          disabled={changingPassword}
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

          <Button type="primary" htmlType="submit" loading={changingPassword}>
            修改密码
          </Button>
        </Form>
      </Card>

      <Card title="登录会话" size="small" style={{ maxWidth: 400, marginTop: 16 }}>
        <Space direction="vertical">
          <Text type="secondary">撤销此前签发的登录凭证，仅当前设备获得新会话。修改密码则会退出所有设备。</Text>
          <Button onClick={revokeOtherSessions}>退出其他设备</Button>
        </Space>
      </Card>

      {/* TODO: 企业微信绑定暂时屏蔽，等可信IP配置完成后恢复 */}
      {/* eslint-disable-next-line no-constant-binary-expression -- Keep enterprise binding disabled pending real OAuth acceptance. */}
      {false && wxConfig?.configured && (
        <Card title="企业微信绑定" size="small" style={{ maxWidth: 400, marginTop: 16 }}>
          {bindStatus?.bound ? (
            <Space direction="vertical" size={12}>
              <div>
                <Text type="secondary">已绑定：</Text>
                <Tag color="green" style={{ marginLeft: 8 }}>{bindStatus?.wxWorkName}</Tag>
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
    </AppCard>
  );
}
