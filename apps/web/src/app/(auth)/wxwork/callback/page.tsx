'use client';

import { useEffect, useState } from 'react';
import { Spin, Result, Button, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { wxWorkApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

const { Text } = Typography;

export default function WxWorkCallbackPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) {
      setError('授权失败：未获取到授权码');
      setLoading(false);
      return;
    }

    wxWorkApi.callback(code)
      .then((res) => {
        setAuth(res.data.accessToken, res.data.user);
        qc.clear();
        router.push('/servers');
      })
      .catch((err) => {
        const msg = err.response?.data?.message ?? '企业微信登录失败';
        setError(Array.isArray(msg) ? msg[0] : msg);
        setLoading(false);
      });
  }, [setAuth, qc, router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="正在登录..." />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Result
        status="error"
        title="登录失败"
        subTitle={<Text type="secondary">{error}</Text>}
        extra={
          <Button type="primary" onClick={() => router.push('/login')}>
            返回登录页
          </Button>
        }
      />
    </div>
  );
}
