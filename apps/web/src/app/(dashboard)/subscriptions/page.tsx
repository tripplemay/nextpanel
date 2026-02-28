'use client';

import { useState } from 'react';
import { App, Button, Table, Space, Card, Popconfirm, Input, Modal, QRCode } from 'antd';
import { QrcodeOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import SubscriptionFormModal from '@/components/subscriptions/SubscriptionFormModal';
import PageHeader from '@/components/common/PageHeader';
import CopyButton from '@/components/common/CopyButton';
import type { Subscription } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

export default function SubscriptionsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<string | null>(null);

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

  function getSubUrl(token: string) {
    return `${window.location.origin}/api/subscriptions/link/${token}`;
  }

  const columns: ColumnType<Subscription>[] = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '订阅链接',
      render: (_: unknown, r) => (
        <Input
          readOnly
          value={getSubUrl(r.token)}
          suffix={
            <CopyButton
              text={getSubUrl(r.token)}
              size="small"
            />
          }
        />
      ),
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
            icon={<QrcodeOutlined />}
            onClick={() => setQrTarget(getSubUrl(record.token))}
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

      <Modal
        open={!!qrTarget}
        footer={null}
        onCancel={() => setQrTarget(null)}
        title="订阅二维码"
        width={300}
      >
        {qrTarget && (
          <div style={{ textAlign: 'center', padding: 16 }}>
            <QRCode value={qrTarget} size={220} />
          </div>
        )}
      </Modal>
    </Card>
  );
}
