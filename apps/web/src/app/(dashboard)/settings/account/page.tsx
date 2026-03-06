'use client';

import { App, Button, Card, Form, Input } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import type { AxiosError } from 'axios';

export default function AccountSettingsPage() {
  const { message } = App.useApp();
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
    </Card>
  );
}
