'use client';

import { useState } from 'react';
import { App, Button, Table, Space, Card, Popconfirm, Modal, QRCode, Tabs, Input, Tag, Typography } from 'antd';
import { QrcodeOutlined, CopyOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import SubscriptionFormModal from '@/components/subscriptions/SubscriptionFormModal';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import type { Subscription } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

interface SubFormat {
  key: string;
  label: string;
  url: string;
}

function getFormats(token: string): SubFormat[] {
  const base = `${window.location.origin}/api/subscriptions/link/${token}`;
  return [
    { key: 'v2ray', label: 'V2Ray / Xray Base64', url: base },
    { key: 'clash', label: 'Clash / Mihomo YAML', url: `${base}/clash` },
    { key: 'singbox', label: 'Sing-box JSON', url: `${base}/singbox` },
  ];
}

export default function SubscriptionsPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Subscription | null>(null);
  const [linkTarget, setLinkTarget] = useState<SubFormat[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => subscriptionsApi.list().then((r) => r.data),
    refetchInterval: 10_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => subscriptionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      message.success('订阅已删除');
    },
    onError: () => message.error('删除失败'),
  });

  const refreshTokenMutation = useMutation({
    mutationFn: (id: string) => subscriptionsApi.refreshToken(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      // Auto-open export modal with the new token
      setLinkTarget(getFormats(res.data.token));
      message.success('订阅链接已刷新，请重新导入');
    },
    onError: () => message.error('刷新失败'),
  });

  function confirmRefreshToken(record: Subscription) {
    modal.confirm({
      title: '确认刷新订阅链接？',
      content: '旧链接将立即失效，所有使用旧链接的客户端需重新导入新链接才能正常使用。',
      okText: '确认刷新',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => refreshTokenMutation.mutate(record.id),
    });
  }

  const expandedRowRender = (record: Subscription) => (
    <Table
      rowKey={(sn) => sn.node.id}
      size="small"
      dataSource={record.nodes}
      pagination={false}
      columns={[
        { title: '节点名称', render: (_: unknown, sn) => sn.node.name },
        {
          title: '协议',
          render: (_: unknown, sn) => <Tag color="blue">{sn.node.protocol}</Tag>,
        },
        { title: '端口', render: (_: unknown, sn) => sn.node.listenPort },
        {
          title: '状态',
          render: (_: unknown, sn) => <StatusTag status={sn.node.status} enabled={sn.node.enabled} />,
        },
      ]}
      style={{ marginBlock: 0 }}
    />
  );

  const columns: ColumnType<Subscription>[] = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '节点数',
      render: (_: unknown, r) => (
        <Typography.Text type="secondary">{r.nodes.length} 个节点</Typography.Text>
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
        <Space size={4}>
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
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => setEditTarget(record)}
          >
            编辑
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={refreshTokenMutation.isPending}
            onClick={() => confirmRefreshToken(record)}
          >
            刷新链接
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
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="订阅管理"
        addLabel="新增订阅"
        onAdd={() => setCreateOpen(true)}
      />
      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data}
        columns={columns}
        pagination={{ showTotal: (total) => `共 ${total} 条` }}
        expandable={{ expandedRowRender }}
      />

      {/* Create modal */}
      <SubscriptionFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ['subscriptions'] });
        }}
      />

      {/* Edit modal */}
      <SubscriptionFormModal
        open={!!editTarget}
        subscription={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => {
          setEditTarget(null);
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

      {/* QR code modal */}
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
