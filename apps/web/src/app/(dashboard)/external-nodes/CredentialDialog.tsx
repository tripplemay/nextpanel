'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Input, Modal, Typography } from 'antd';
import type { AxiosError } from 'axios';
import { externalNodesApi } from '@/lib/api';
import type { ExternalNode, ExternalNodeCredentials } from '@/types/api';

export default function CredentialDialog({ node, onClose }: { node: ExternalNode; onClose: () => void }) {
  const { message } = App.useApp();
  const [password, setPassword] = useState('');
  const [secrets, setSecrets] = useState<ExternalNodeCredentials | null>(null);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!secrets) return;
    const timer = window.setTimeout(onClose, 60_000);
    return () => window.clearTimeout(timer);
  }, [secrets, onClose]);

  async function reveal() {
    if (pending) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    try {
      const { data } = await externalNodesApi.credentials(node.id, password, controller.signal);
      if (!controller.signal.aborted) setSecrets(data);
    } catch (err) {
      if (!controller.signal.aborted) {
        const detail = (err as AxiosError<{ message: string }>).response?.data?.message;
        message.error(typeof detail === 'string' ? detail : '读取失败，请稍后重试');
      }
    } finally {
      if (!controller.signal.aborted) { setPending(false); setPassword(''); }
    }
  }

  return (
    <Modal open title={`节点凭据：${node.name}`} onCancel={onClose}
      onOk={secrets ? onClose : reveal} okText={secrets ? '关闭' : '验证并查看'}
      okButtonProps={{ disabled: !secrets && !password }} confirmLoading={pending} destroyOnHidden>
      {secrets ? (
        <>
          <Typography.Paragraph type="warning">敏感信息，请勿分享或截图。60 秒后自动关闭，不写入本地缓存。</Typography.Paragraph>
          {Object.entries(secrets).filter(([, value]) => value !== null).map(([key, value]) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <Typography.Text strong>{key}</Typography.Text>
              <Input.TextArea aria-label={key} value={value ?? ''} readOnly autoSize={{ minRows: 1, maxRows: 5 }} />
            </div>
          ))}
        </>
      ) : (
        <>
          <Typography.Paragraph>请输入当前账户密码。此次凭据访问将记入审计日志。</Typography.Paragraph>
          <Input.Password aria-label="确认当前密码" autoComplete="current-password" value={password}
            disabled={pending} onChange={event => setPassword(event.target.value)} onPressEnter={() => { if (password) void reveal(); }} />
        </>
      )}
    </Modal>
  );
}
