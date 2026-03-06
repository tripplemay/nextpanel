'use client';

import { Modal, Spin, Input, Button, Space, QRCode, Empty, Alert } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { nodesApi } from '@/lib/api';
import type { Node } from '@/types/api';

interface Props {
  node: Node | null;
  onClose: () => void;
}

export default function NodeShareModal({ node, onClose }: Props) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['node-share', node?.id],
    queryFn: () => nodesApi.shareLink(node!.id).then((r) => r.data),
    enabled: !!node,
    retry: false,
  });

  const uri = data?.uri ?? null;

  return (
    <Modal
      open={!!node}
      destroyOnClose
      title={`分享节点 — ${node?.name ?? ''}`}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      {isLoading && (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      )}

      {isError && (
        <Alert
          type="error"
          message="获取分享链接失败"
          description={
            (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
            String(error)
          }
          action={<Button size="small" onClick={() => refetch()}>重试</Button>}
        />
      )}

      {!isLoading && !isError && !uri && (
        <Empty description="该协议暂不支持分享链接" />
      )}

      {!isLoading && !isError && uri && (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>分享链接</div>
            <Space.Compact style={{ width: '100%' }}>
              <Input value={uri} readOnly />
              <Button onClick={() => navigator.clipboard.writeText(uri)}>复制</Button>
            </Space.Compact>
          </div>
          <div style={{ textAlign: 'center' }}>
            <QRCode value={uri} size={200} />
            <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
              扫码导入客户端
            </div>
          </div>
        </Space>
      )}
    </Modal>
  );
}
