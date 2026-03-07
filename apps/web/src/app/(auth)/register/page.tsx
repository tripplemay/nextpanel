'use client';

import { useState } from 'react';
import { App, Form, Input, Button, Typography } from 'antd';
import { UserOutlined, LockOutlined, KeyOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import AuthLayout from '@/components/auth/AuthLayout';

const { Title, Text } = Typography;

export default function RegisterPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; password: string; confirmPassword: string; inviteCode: string }) {
    if (values.password !== values.confirmPassword) {
      message.error('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      await authApi.register({
        username: values.username,
        password: values.password,
        inviteCode: values.inviteCode,
      });
      localStorage.setItem('showWelcome', '1');
      message.success('注册成功，请登录');
      router.push('/login');
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        message.error('用户名已被占用');
      } else if (status === 400) {
        message.error('邀请码无效或已使用完毕');
      } else {
        message.error('注册失败，请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Title level={3} style={{ marginBottom: 4 }}>
        创建账号
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 32 }}>
        需要邀请码才能注册
      </Text>
      <Form layout="vertical" onFinish={onFinish}>
        <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input prefix={<UserOutlined />} placeholder="用户名" size="large" />
        </Form.Item>
        <Form.Item
          name="password"
          rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '密码至少 8 位' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="密码（至少 8 位）" size="large" />
        </Form.Item>
        <Form.Item name="confirmPassword" rules={[{ required: true, message: '请确认密码' }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="确认密码" size="large" />
        </Form.Item>
        <Form.Item name="inviteCode" rules={[{ required: true, message: '请输入邀请码' }]}>
          <Input prefix={<KeyOutlined />} placeholder="邀请码" size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block size="large" loading={loading}>
          注册
        </Button>
      </Form>
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <Text type="secondary">已有账号？</Text>{' '}
        <Link href="/login">立即登录</Link>
      </div>
    </AuthLayout>
  );
}
