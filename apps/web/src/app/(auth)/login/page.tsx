'use client';

import { useState } from 'react';
import { App, Form, Input, Button, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import AuthLayout from '@/components/auth/AuthLayout';

const { Title, Text } = Typography;

export default function LoginPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

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
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Text type="secondary">没有账号？</Text>{' '}
        <Link href="/register">注册账号</Link>
      </div>
    </AuthLayout>
  );
}
