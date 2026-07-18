'use client';

import { useState } from 'react';
import { Modal, Spin, Button, Space, QRCode, Empty, Alert, Tabs, Typography, theme as antdTheme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { nodesApi } from '@/lib/api';
import CopyButton from '@/components/common/CopyButton';
import { useThemeTokens } from '@/theme/ThemeContext';
import { statusColors } from '@/theme/semantic';
import type { Node } from '@/types/api';

interface Props {
  node: Node | null;
  onClose: () => void;
}

/** 链接展示行：token 化底色块 + 等宽字体 + 复制按钮 */
function LinkBlock({ url, label }: { url: string; label?: string }) {
  const { token } = antdTheme.useToken();
  return (
    <div>
      {label && (
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
          {label}
        </Typography.Text>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadius,
          padding: '6px 8px 6px 12px',
        }}
      >
        <Typography.Text
          style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: token.fontFamilyCode }}
          ellipsis={{ tooltip: url }}
        >
          {url}
        </Typography.Text>
        <CopyButton text={url} size="small" />
      </div>
    </div>
  );
}

/** 二维码卡片：始终保持白底黑码，暗色主题下也可正常扫码 */
function QrCard({ value, size = 200 }: { value: string; size?: number }) {
  const { token } = antdTheme.useToken();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          padding: 12,
          background: '#fff',
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          lineHeight: 0,
        }}
      >
        <QRCode value={value} size={size} color="#000" bgColor="#fff" bordered={false} />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        扫码导入客户端
      </Typography.Text>
    </div>
  );
}

/** Hiddify 一键导入主按钮：语义成功色 + hover 抬升 */
function HiddifyImportButton({ url }: { url: string }) {
  const tokens = useThemeTokens();
  const [hover, setHover] = useState(false);
  return (
    <a href={url}>
      <Button
        type="primary"
        size="large"
        style={{
          background: statusColors.success,
          borderColor: statusColors.success,
          fontWeight: 500,
          padding: '0 32px',
          transform: hover ? 'translateY(-1px)' : 'none',
          boxShadow: hover ? tokens.cardShadowHover : 'none',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        一键导入 Hiddify
      </Button>
    </a>
  );
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
      destroyOnHidden
      title={`分享节点 — ${node?.name ?? ''}`}
      onCancel={onClose}
      footer={null}
      width={560}
      style={{ maxWidth: '95vw' }}
    >
      {isLoading && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
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
        <Tabs
          items={[
            {
              key: 'uri',
              label: '通用链接',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <LinkBlock url={uri} label="分享链接" />
                  <QrCard value={uri} />
                </Space>
              ),
            },
            {
              key: 'hiddify',
              label: 'Hiddify',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    推荐使用 Hiddify 客户端，全平台免费开源
                  </Typography.Text>
                  <div style={{ textAlign: 'center' }}>
                    <HiddifyImportButton url={`hiddify://import/${uri}#NextPanel`} />
                  </div>
                  <QrCard value={uri} />
                  <div style={{ textAlign: 'center' }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      下载 Hiddify：<Typography.Link href="https://hiddify.com" target="_blank">hiddify.com</Typography.Link>
                    </Typography.Text>
                  </div>
                </Space>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
}
