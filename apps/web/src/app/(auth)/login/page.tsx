'use client';

import { useEffect, useState } from 'react';
import { App, Form, Input, Button, Typography, Divider } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { authApi, wxWorkApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useIsMobile } from '@/hooks/useIsMobile';
import AuthLayout from '@/components/auth/AuthLayout';

const { Title, Text } = Typography;

export default function LoginPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const qc = useQueryClient();
  const { isMobile } = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [wxLoading, setWxLoading] = useState(false);

  const { data: wxConfig } = useQuery({
    queryKey: ['wxwork-configured'],
    queryFn: () => wxWorkApi.configured().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      const res = await authApi.login(values.username, values.password);
      setAuth(res.data.accessToken, res.data.user);
      qc.clear();
      router.push('/servers');
    } catch {
      message.error('用户名或密码错误');
    } finally {
      setLoading(false);
    }
  }

  async function handleWxWorkLogin() {
    setWxLoading(true);
    try {
      const device = isMobile ? 'mobile' : 'desktop';
      const res = await wxWorkApi.loginUrl(device);
      window.location.href = res.data.url;
    } catch {
      message.error('获取企业微信登录链接失败');
      setWxLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Title level={3} style={{ marginBottom: 4 }}>
        欢迎回来
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 32 }}>
        登录你的 NextPanel 账号
      </Text>
      <Form layout="vertical" onFinish={onFinish}>
        <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="密码" size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={loading}>
          登录
        </Button>
      </Form>

      {wxConfig?.configured && (
        <>
          <Divider plain style={{ margin: '24px 0 16px', color: '#8c8c8c', fontSize: 13 }}>
            或
          </Divider>
          <Button
            block
            size="large"
            loading={wxLoading}
            onClick={handleWxWorkLogin}
            style={{
              background: '#07c160',
              borderColor: '#07c160',
              color: '#fff',
              fontWeight: 500,
            }}
          >
            企业微信登录
          </Button>
        </>
      )}

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Text type="secondary">没有账号？</Text>{' '}
        <Link href="/register">注册账号</Link>
      </div>
    </AuthLayout>
  );
}
