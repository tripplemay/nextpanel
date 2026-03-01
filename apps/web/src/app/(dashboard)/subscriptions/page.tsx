'use client';

import { useState } from 'react';
import { App, Button, Table, Space, Card, Popconfirm, Modal, QRCode, Tabs, Input } from 'antd';
import { QrcodeOutlined, CopyOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import SubscriptionFormModal from '@/components/subscriptions/SubscriptionFormModal';
import PageHeader from '@/components/common/PageHeader';
import type { Subscription } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

interface SubFormat {
  key: string;
  label: string;
  url: string;
}

export default function SubscriptionsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<SubFormat[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => subscriptionsApi.list().then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => subscriptionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      message.success('订阅已删除');
    },
    onError: () => message.error('删除失败'),
  });

  function getFormats(token: string): SubFormat[] {
    const base = `${window.location.origin}/api/subscriptions/link/${token}`;
    return [
      { key: 'v2ray', label: 'V2Ray / Xray Base64', url: base },
      { key: 'clash', label: 'Clash / Mihomo YAML', url: `${base}/clash` },
      { key: 'singbox', label: 'Sing-box JSON', url: `${base}/singbox` },
    ];
  }

  const columns: ColumnType<Subscription>[] = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '节点数',
      render: (_: unknown, r) => r.nodes.length,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '操作',
      render: (_: unknown, record) => (
        <Space>
          <Button
            size="small"
            type="primary"
            onClick={() => setLinkTarget(getFormats(record.token))}
          >
            导出链接
          </Button>
          <Button
            size="small"
            icon={<QrcodeOutlined />}
            onClick={() => {
              const base = `${window.location.origin}/api/subscriptions/link/${record.token}`;
              setQrUrl(base);
            }}
          >
            二维码
          </Button>
          <Popconfirm
            title="确认删除该订阅？"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="删除"
            okType="danger"
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <PageHeader
        title="订阅管理"
        addLabel="新增订阅"
        onAdd={() => setCreateOpen(true)}
      />
      <Table rowKey="id" loading={isLoading} dataSource={data} columns={columns} />

      <SubscriptionFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ['subscriptions'] });
        }}
      />

      {/* Export links modal */}
      <Modal
        open={!!linkTarget}
        footer={null}
        onCancel={() => setLinkTarget(null)}
        title="订阅链接"
        width={560}
      >
        {linkTarget && (
          <Tabs
            items={linkTarget.map((f) => ({
              key: f.key,
              label: f.label,
              children: (
                <Space.Compact style={{ width: '100%' }}>
                  <Input value={f.url} readOnly />
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(f.url);
                      message.success('已复制');
                    }}
                  >
                    复制
                  </Button>
                </Space.Compact>
              ),
            }))}
          />
        )}
      </Modal>

      {/* QR code modal (Base64 universal) */}
      <Modal
        open={!!qrUrl}
        footer={null}
        onCancel={() => setQrUrl(null)}
        title="订阅二维码（通用格式）"
        width={300}
      >
        {qrUrl && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <QRCode value={qrUrl} size={220} />
          </div>
        )}
      </Modal>
    </Card>
  );
}
