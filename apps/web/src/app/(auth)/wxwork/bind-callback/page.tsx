'use client';

import { useEffect, useState } from 'react';
import { Spin, Result, Button, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { wxWorkApi } from '@/lib/api';

const { Text } = Typography;

export default function WxWorkBindCallbackPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [wxName, setWxName] = useState('');

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) {
      setErrorMsg('授权失败：未获取到授权码');
      setStatus('error');
      return;
    }

    wxWorkApi.bind(code)
      .then((res) => {
        setWxName(res.data.wxWorkName);
        setStatus('success');
        qc.invalidateQueries({ queryKey: ['wxwork-bind-status'] });
      })
      .catch((err) => {
        const msg = err.response?.data?.message ?? '绑定失败';
        setErrorMsg(Array.isArray(msg) ? msg[0] : msg);
        setStatus('error');
      });
  }, [qc]);

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="正在绑定..." />
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result
          status="success"
          title="绑定成功"
          subTitle={<Text>已绑定企业微信账号：{wxName}</Text>}
          extra={
            <Button type="primary" onClick={() => router.push('/settings/account')}>
              返回账户设置
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Result
        status="error"
        title="绑定失败"
        subTitle={<Text type="secondary">{errorMsg}</Text>}
        extra={
          <Button type="primary" onClick={() => router.push('/settings/account')}>
            返回账户设置
          </Button>
        }
      />
    </div>
  );
}
