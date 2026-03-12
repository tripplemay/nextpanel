'use client';

import { useState } from 'react';
import { App, Button, Table, Space, Card, Tag, Typography, Collapse, Empty, QRCode, Tabs, Input, Modal, Divider, Dropdown } from 'antd';
import { EditOutlined, ReloadOutlined, DeleteOutlined, ExportOutlined, TeamOutlined, MoreOutlined } from '@ant-design/icons';
import { useIsMobile } from '@/hooks/useIsMobile';
import ServerTagList from '@/components/servers/ServerTagList';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import SubscriptionFormModal from '@/components/subscriptions/SubscriptionFormModal';
import SubscriptionShareManager from '@/components/subscriptions/SubscriptionShareManager';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import type { Subscription, ViewerSubscriptionList } from '@/types/api';

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

function getShareFormats(shareToken: string): SubFormat[] {
  const base = `${window.location.origin}/api/subscriptions/share/${shareToken}`;
  return [
    { key: 'v2ray', label: 'V2Ray / Xray Base64', url: base },
    { key: 'clash', label: 'Clash / Mihomo YAML', url: `${base}/clash` },
    { key: 'singbox', label: 'Sing-box JSON', url: `${base}/singbox` },
  ];
}

function buildNodeRows(sub: Subscription) {
  type UnifiedRow =
    | { kind: 'managed'; id: string; name: string; protocol: string; listenPort: number; status: string; enabled: boolean; serverTags: string[]; serverAutoTags: string[] }
    | { kind: 'external'; id: string; name: string; protocol: string; listenPort: number };
  return [
    ...sub.nodes.map((sn) => ({ kind: 'managed' as const, id: sn.node.id, name: sn.node.name, protocol: sn.node.protocol, listenPort: sn.node.listenPort, status: sn.node.status, enabled: sn.node.enabled, serverTags: sn.node.server?.tags ?? [], serverAutoTags: sn.node.server?.autoTags ?? [] })),
    ...(sub.externalNodes ?? []).map((en) => ({ kind: 'external' as const, id: en.externalNode.id, name: en.externalNode.name, protocol: en.externalNode.protocol, listenPort: en.externalNode.port })),
  ];
}

function NodeTable({ sub }: { sub: Subscription }) {
  const { isMobile } = useIsMobile();
  const rows = buildNodeRows(sub);
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点" style={{ padding: '16px 0' }} />;
  }

  type Row = typeof rows[number];
  const allColumns = [
    {
      title: '节点名称',
      render: (_: unknown, row: Row) => (
        <Space size={4}>
          {row.name}
          {row.kind === 'managed'
            ? <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>托管</Tag>
            : <Tag color="orange" style={{ margin: 0, fontSize: 11 }}>外部</Tag>
          }
        </Space>
      ),
    },
    {
      title: '协议',
      render: (_: unknown, row: Row) => <Tag color="blue">{row.protocol}</Tag>,
    },
    { title: '端口', render: (_: unknown, row: Row) => row.listenPort },
    {
      title: '标签',
      render: (_: unknown, row: Row) =>
        row.kind === 'managed' && (row.serverTags.length > 0 || row.serverAutoTags.length > 0)
          ? <ServerTagList tags={row.serverTags} autoTags={row.serverAutoTags} readonly />
          : null,
    },
    {
      title: '状态',
      render: (_: unknown, row: Row) =>
        row.kind === 'managed'
          ? <StatusTag status={row.status} enabled={row.enabled} />
          : <Tag>外部</Tag>,
    },
  ];

  const MOBILE_KEEP = new Set(['节点名称', '状态']);
  const columns = isMobile
    ? allColumns.filter((c) => MOBILE_KEEP.has(c.title as string))
    : allColumns;

  return (
    <Table
      rowKey="id"
      size="middle"
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      pagination={rows.length > 10 ? { showTotal: (total) => `共 ${total} 条` } : false}
      columns={columns}
    />
  );
}

export default function SubscriptionsPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isViewer = user?.role === 'VIEWER';

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Subscription | null>(null);
  const [linkTarget, setLinkTarget] = useState<SubFormat[] | null>(null);
  const [shareManagerId, setShareManagerId] = useState<string | null>(null);

  const { isMobile } = useIsMobile();

  const { data: rawData, isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => subscriptionsApi.list().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Split data based on role
  const viewerData = isViewer ? (rawData as ViewerSubscriptionList | undefined) : undefined;
  const ownerData = !isViewer ? (rawData as Subscription[] | undefined) : undefined;

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

  function confirmDelete(record: Subscription) {
    modal.confirm({
      title: '确认删除该订阅？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteMutation.mutate(record.id),
    });
  }

  // Build collapse items for a list of subscriptions
  function buildCollapseItems(subs: Subscription[], opts: { readonly?: boolean; useShareToken?: boolean }) {
    return subs.map((sub) => {
      const totalCount = sub.nodes.length + (sub.externalNodes?.length ?? 0);
      const shareCount = sub.shares?.length ?? 0;

      return {
        key: sub.id,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 500, flexShrink: 0 }}>{sub.name}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
              {totalCount} 个节点
            </Typography.Text>
            {!opts.readonly && !isViewer && (
              <Tag
                icon={<TeamOutlined />}
                color={shareCount > 0 ? 'blue' : 'default'}
                style={{ margin: 0, fontSize: 11, flexShrink: 0 }}
              >
                已分享 {shareCount} 人
              </Tag>
            )}
            <div style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
              {isMobile ? (
                <Space size={4}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<ExportOutlined />}
                    onClick={() => {
                      if (opts.useShareToken && sub.shareToken) {
                        setLinkTarget(getShareFormats(sub.shareToken));
                      } else {
                        setLinkTarget(getFormats(sub.token));
                      }
                    }}
                  />
                  {!opts.readonly && (
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          ...(!isViewer ? [{ key: 'share', icon: <TeamOutlined />, label: '分享', onClick: () => setShareManagerId(sub.id) }] : []),
                          { key: 'edit', icon: <EditOutlined />, label: '编辑', onClick: () => setEditTarget(sub) },
                          { key: 'refresh', icon: <ReloadOutlined />, label: '刷新链接', onClick: () => confirmRefreshToken(sub) },
                          { type: 'divider' as const },
                          { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true, onClick: () => confirmDelete(sub) },
                        ],
                      }}
                    >
                      <Button size="small" icon={<MoreOutlined />} />
                    </Dropdown>
                  )}
                </Space>
              ) : (
                <Space size={4}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<ExportOutlined />}
                    onClick={() => {
                      if (opts.useShareToken && sub.shareToken) {
                        setLinkTarget(getShareFormats(sub.shareToken));
                      } else {
                        setLinkTarget(getFormats(sub.token));
                      }
                    }}
                  >
                    导出链接
                  </Button>
                  {!opts.readonly && (
                    <>
                      {!isViewer && (
                        <Button
                          size="small"
                          icon={<TeamOutlined />}
                          onClick={() => setShareManagerId(sub.id)}
                        >
                          分享
                        </Button>
                      )}
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => setEditTarget(sub)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        loading={refreshTokenMutation.isPending}
                        onClick={() => confirmRefreshToken(sub)}
                      >
                        刷新链接
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => confirmDelete(sub)}
                      >
                        删除
                      </Button>
                    </>
                  )}
                </Space>
              )}
            </div>
          </div>
        ),
        children: <NodeTable sub={sub} />,
      };
    });
  }

  // ── VIEWER view ─────────────────────────────────────────────────────────────
  if (isViewer) {
    const mine = viewerData?.mine ?? [];
    const shared = viewerData?.shared ?? [];

    return (
      <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <PageHeader
          title="我的订阅"
          addLabel="新增订阅"
          onAdd={() => setCreateOpen(true)}
        />

        {!isLoading && mine.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无订阅" style={{ padding: '24px 0' }} />
        ) : (
          <Collapse
            defaultActiveKey={mine.map((s) => s.id)}
            items={buildCollapseItems(mine, { readonly: false })}
            style={{ background: 'transparent' }}
          />
        )}

        <Divider orientation="left" style={{ marginTop: 32 }}>共享订阅</Divider>

        {!isLoading && shared.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分享给你的订阅" style={{ padding: '24px 0' }} />
        ) : (
          <Collapse
            defaultActiveKey={shared.map((s) => s.id)}
            items={buildCollapseItems(shared, { readonly: true, useShareToken: true })}
            style={{ background: 'transparent' }}
          />
        )}

        <SubscriptionFormModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['subscriptions'] });
          }}
        />
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
        <Modal open={!!linkTarget} footer={null} onCancel={() => setLinkTarget(null)} title="订阅链接" width={560} style={{ maxWidth: '95vw' }}>
          {linkTarget && <LinkTabs formats={linkTarget} onCopy={(url) => { navigator.clipboard.writeText(url); message.success('已复制'); }} />}
        </Modal>
      </Card>
    );
  }

  // ── ADMIN / OPERATOR view ────────────────────────────────────────────────────
  const subs = ownerData ?? [];

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="订阅管理"
        addLabel="新增订阅"
        onAdd={() => setCreateOpen(true)}
      />

      {isLoading ? null : subs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无订阅" style={{ padding: '32px 0' }} />
      ) : (
        <Collapse
          defaultActiveKey={subs.map((s) => s.id)}
          items={buildCollapseItems(subs, { readonly: false })}
          style={{ background: 'transparent' }}
        />
      )}

      <SubscriptionFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ['subscriptions'] });
        }}
      />
      <SubscriptionFormModal
        open={!!editTarget}
        subscription={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => {
          setEditTarget(null);
          qc.invalidateQueries({ queryKey: ['subscriptions'] });
        }}
      />

      {/* Share manager modal */}
      <Modal
        open={!!shareManagerId}
        footer={null}
        onCancel={() => setShareManagerId(null)}
        title="分享订阅给用户"
        width={480}
        style={{ maxWidth: '95vw' }}
      >
        {shareManagerId && (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              被分享的用户将获得专属链接，可导入到客户端使用。取消分享后专属链接立即失效。
            </Typography.Text>
            <Divider style={{ margin: '12px 0' }} />
            <SubscriptionShareManager subscriptionId={shareManagerId} />
          </>
        )}
      </Modal>

      {/* Export links modal */}
      <Modal open={!!linkTarget} footer={null} onCancel={() => setLinkTarget(null)} title="订阅链接" width={560} style={{ maxWidth: '95vw' }}>
        {linkTarget && <LinkTabs formats={linkTarget} onCopy={(url) => { navigator.clipboard.writeText(url); message.success('已复制'); }} />}
      </Modal>
    </Card>
  );
}

function LinkTabs({ formats, onCopy }: { formats: SubFormat[]; onCopy: (url: string) => void }) {
  return (
    <Tabs
      items={formats.map((f) => ({
        key: f.key,
        label: f.label,
        children: (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Space.Compact style={{ width: '100%' }}>
              <Input value={f.url} readOnly />
              <Button onClick={() => onCopy(f.url)}>复制</Button>
            </Space.Compact>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <QRCode value={f.url} size={200} />
            </div>
          </Space>
        ),
      }))}
    />
  );
}
