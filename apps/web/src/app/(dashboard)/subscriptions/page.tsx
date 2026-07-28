'use client';

import { useState } from 'react';
import { App, Button, Table, Space, Card, Tag, Typography, Collapse, Empty, QRCode, Tabs, Modal, Divider, Dropdown, theme as antdTheme } from 'antd';
import type { ColumnType } from 'antd/es/table';
import { EditOutlined, ReloadOutlined, DeleteOutlined, ExportOutlined, TeamOutlined, MoreOutlined, DownloadOutlined } from '@ant-design/icons';
import { useIsMobile } from '@/hooks/useIsMobile';
import ServerTagList from '@/components/servers/ServerTagList';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import SubscriptionFormModal from '@/components/subscriptions/SubscriptionFormModal';
import SubscriptionShareManager from '@/components/subscriptions/SubscriptionShareManager';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import AppCard from '@/components/common/AppCard';
import EmptyState from '@/components/common/EmptyState';
import CopyButton from '@/components/common/CopyButton';
import { TableSkeleton } from '@/components/common/skeletons';
import { useThemeTokens } from '@/theme/ThemeContext';
import { statusColors } from '@/theme/semantic';
import type { Subscription, ViewerSubscriptionList } from '@/types/api';

interface SubFormat {
  key: string;
  label: string;
  url: string;
  /** Hiddify: the actual sing-box subscription URL; `url` is the app deep link. */
  extra?: string;
}

function buildFormats(base: string): SubFormat[] {
  const singboxUrl = `${base}/singbox`;
  return [
    {
      key: 'hiddify',
      label: 'Hiddify（推荐）',
      url: `hiddify://import/${singboxUrl}#NextPanel`,
      extra: singboxUrl,
    },
    { key: 'clash', label: 'Clash / Mihomo', url: `${base}/clash` },
    { key: 'singbox', label: 'Sing-box JSON', url: singboxUrl },
    { key: 'homeproxy', label: 'HomeProxy (OpenWrt)', url: `${base}/homeproxy` },
    { key: 'v2ray', label: 'V2Ray / Xray Base64', url: base },
  ];
}

function getFormats(token: string): SubFormat[] {
  return buildFormats(`${window.location.origin}/api/subscriptions/link/${token}`);
}

function getShareFormats(shareToken: string): SubFormat[] {
  return buildFormats(`${window.location.origin}/api/subscriptions/share/${shareToken}`);
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

function NodeTable({ sub }: { sub: Subscription }) {
  const { isMobile, isTablet } = useIsMobile();
  const { token } = antdTheme.useToken();
  const rows = buildNodeRows(sub);
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点" style={{ padding: '16px 0' }} />;
  }

  type Row = typeof rows[number];

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => (
          <Card key={row.id} size="small" style={{ borderRadius: token.borderRadiusLG }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1, marginRight: 8 }}>
                <Typography.Text strong style={{ fontSize: 14, minWidth: 0 }} ellipsis>{row.name}</Typography.Text>
                {row.kind === 'managed'
                  ? <Tag color="blue" style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>托管</Tag>
                  : <Tag color="orange" style={{ margin: 0, fontSize: 11, flexShrink: 0 }}>外部</Tag>
                }
              </div>
              <div style={{ flexShrink: 0 }}>
                {row.kind === 'managed'
                  ? <StatusTag status={row.status} enabled={row.enabled} />
                  : <Tag>外部</Tag>
                }
              </div>
            </div>
            <Tag color="blue" style={{ margin: 0 }}>{row.protocol}</Tag>
          </Card>
        ))}
      </div>
    );
  }

  const allColumns: ColumnType<Row>[] = [
    {
      title: '节点名称',
      ellipsis: true,
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

  const TABLET_KEEP = new Set(['节点名称', '协议', '状态']);
  const columns = isTablet
    ? allColumns.filter((c) => TABLET_KEEP.has(c.title as string))
    : allColumns;

  return (
    <Table
      rowKey="id"
      size="middle"
      dataSource={rows}
      scroll={isTablet ? undefined : { x: 'max-content' }}
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
  const { token } = antdTheme.useToken();

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

  // Detect response shape instead of relying on cached role
  // (role in Zustand may be stale if admin changed it after login)
  const isViewerResponse = rawData != null && !Array.isArray(rawData) && 'mine' in rawData;
  const viewerData = isViewerResponse ? (rawData as ViewerSubscriptionList) : undefined;
  const ownerData = !isViewerResponse ? (rawData as Subscription[] | undefined) : undefined;

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            {/* 主标题 + 次要信息 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Typography.Text strong style={{ fontSize: 14, minWidth: 0 }} ellipsis={{ tooltip: sub.name }}>
                  {sub.name}
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
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {totalCount} 个节点
              </Typography.Text>
            </div>
            <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
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

  const collapseStyle = { background: 'transparent', borderColor: token.colorBorderSecondary };

  // ── First-load skeleton ─────────────────────────────────────────────────────
  if (isLoading) {
    return <TableSkeleton rows={4} />;
  }

  // ── VIEWER view ─────────────────────────────────────────────────────────────
  if (isViewerResponse) {
    const mine = viewerData?.mine ?? [];
    const shared = viewerData?.shared ?? [];

    return (
      <AppCard>
        <PageHeader
          title="我的订阅"
          addLabel="新增订阅"
          onAdd={() => setCreateOpen(true)}
        />

        {mine.length === 0 ? (
          <EmptyState
            title="还没有订阅"
            description="创建订阅后可将一组节点打包成一个订阅链接，导入客户端即可使用"
            actionLabel="新增订阅"
            onAction={() => setCreateOpen(true)}
          />
        ) : (
          <Collapse
            defaultActiveKey={mine.map((s) => s.id)}
            items={buildCollapseItems(mine, { readonly: false })}
            style={collapseStyle}
          />
        )}

        <Divider titlePlacement="start" style={{ marginTop: 32 }}>共享订阅</Divider>

        {shared.length === 0 ? (
          <EmptyState title="暂无分享给你的订阅" />
        ) : (
          <Collapse
            defaultActiveKey={shared.map((s) => s.id)}
            items={buildCollapseItems(shared, { readonly: true, useShareToken: true })}
            style={collapseStyle}
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
          {linkTarget && <LinkTabs formats={linkTarget} />}
        </Modal>
      </AppCard>
    );
  }

  // ── ADMIN / OPERATOR view ────────────────────────────────────────────────────
  const subs = ownerData ?? [];

  return (
    <AppCard>
      <PageHeader
        title="订阅管理"
        addLabel="新增订阅"
        onAdd={() => setCreateOpen(true)}
      />

      {subs.length === 0 ? (
        <EmptyState
          title="还没有订阅"
          description="创建订阅后可将一组节点打包成一个订阅链接，导入客户端即可使用"
          actionLabel="新增订阅"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <Collapse
          defaultActiveKey={subs.map((s) => s.id)}
          items={buildCollapseItems(subs, { readonly: false })}
          style={collapseStyle}
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
        {linkTarget && <LinkTabs formats={linkTarget} />}
      </Modal>
    </AppCard>
  );
}

const FORMAT_DESCRIPTIONS: Record<string, string> = {
  clash: '支持 VLESS XHTTP、TUIC 和 AnyTLS，适配 Clash Verge、Mihomo Party 等 Mihomo 内核客户端，并包含广告屏蔽、流媒体、AI 服务和国内直连规则。',
  singbox: '适合 sing-box 原生客户端及 Hiddify，支持 TUIC 和 AnyTLS。sing-box 暂不支持 XHTTP，因此不会包含 XHTTP 节点。',
  v2ray: '适合支持分享链接的客户端。包含 VLESS XHTTP 和官方 AnyTLS URI；TUIC 暂无统一分享 URI，因此不会出现在此格式中。',
  homeproxy: '适合 OpenWrt 上的 HomeProxy，支持 TUIC 和 AnyTLS，并包含完整分流规则。sing-box 暂不支持 XHTTP，因此不会包含 XHTTP 节点。',
};

function LinkTabs({ formats }: { formats: SubFormat[] }) {
  const { isMobile } = useIsMobile();
  const [showQr, setShowQr] = useState(isMobile);

  const qrToggle = (value: string) => (
    <div style={{ textAlign: 'center' }}>
      <Button type="link" size="small" onClick={() => setShowQr((v) => !v)}>
        {showQr ? '收起二维码' : '显示二维码'}
      </Button>
      {showQr && (
        <div style={{ marginTop: 8 }}>
          <QrCard value={value} />
        </div>
      )}
    </div>
  );

  return (
    <Tabs
      defaultActiveKey="hiddify"
      items={formats.map((f) => ({
        key: f.key,
        label: f.label,
        children: f.key === 'hiddify' ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              Hiddify 支持 iOS、Android、Windows、macOS 和 Linux。本入口使用 sing-box JSON，支持 TUIC 和 AnyTLS；sing-box 暂不支持 XHTTP，因此不会包含 XHTTP 节点。
            </Typography.Text>
            <div style={{ textAlign: 'center' }}>
              <HiddifyImportButton url={f.url} />
            </div>
            {f.extra && <LinkBlock url={f.extra} label="订阅链接（手动添加时复制此链接）" />}
            {f.extra && (isMobile ? <QrCard value={f.extra} size={160} /> : qrToggle(f.extra))}
            <div style={{ textAlign: 'center' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                下载 Hiddify：<Typography.Link href="https://hiddify.com" target="_blank">hiddify.com</Typography.Link>
              </Typography.Text>
            </div>
          </Space>
        ) : f.key === 'homeproxy' ? (
          <HomeProxyTab url={f.url} />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            {FORMAT_DESCRIPTIONS[f.key] && (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {FORMAT_DESCRIPTIONS[f.key]}
              </Typography.Text>
            )}
            <LinkBlock url={f.url} label="订阅链接" />
            {isMobile ? <QrCard value={f.url} size={160} /> : qrToggle(f.url)}
          </Space>
        ),
      }))}
    />
  );
}

const HOMEPROXY_PLUGIN_URL = 'https://github.com/tripplemay/nextpanel/releases/latest/download/luci-app-nextpanel_all.ipk';

const HOMEPROXY_STEPS = [
  '从上方下载 .ipk 文件',
  '进入路由器 LuCI → 系统 → 软件包 → 上传软件包，安装 .ipk',
  '安装完成后进入 LuCI → 服务 → NextPanel，填入下方配置 URL',
  '设置刷新间隔（推荐 24 小时），保存并启用',
  '按插件内向导完成 HomeProxy 初次配置（透明代理模式、LAN 接口等）',
];

function HomeProxyTab({ url }: { url: string }) {
  const { token } = antdTheme.useToken();
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {FORMAT_DESCRIPTIONS['homeproxy']}
      </Typography.Text>

      {/* Download plugin */}
      <div>
        <Typography.Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          第一步：下载路由器插件
        </Typography.Text>
        <Space wrap align="center">
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            href={HOMEPROXY_PLUGIN_URL}
            target="_blank"
          >
            下载 luci-app-nextpanel.ipk
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            适用于 OpenWrt 21.02+ / immortalwrt 23.05+，架构无关
          </Typography.Text>
        </Space>
      </div>

      {/* Config URL */}
      <div>
        <Typography.Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          第二步：在插件中填入配置 URL
        </Typography.Text>
        <LinkBlock url={url} />
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          包含完整分流规则，插件将自动定期拉取最新节点和规则
        </Typography.Text>
      </div>

      {/* Setup guide */}
      <div>
        <Typography.Text strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>
          安装步骤
        </Typography.Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {HOMEPROXY_STEPS.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: token.colorPrimary,
                  color: token.colorTextLightSolid,
                  fontSize: 12,
                  lineHeight: '20px',
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {step}
              </Typography.Text>
            </div>
          ))}
        </div>
      </div>

      {/* Routing rules info */}
      <div
        style={{
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          padding: '12px 16px',
        }}
      >
        <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
          内置分流规则
        </Typography.Text>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[
            { label: '🚫 广告屏蔽', color: 'red' },
            { label: '🤖 AI 服务代理', color: 'purple' },
            { label: '🎬 流媒体代理', color: 'blue' },
            { label: '🇨🇳 国内直连', color: 'green' },
            { label: '🌐 其余走代理', color: 'default' },
          ].map((tag) => (
            <Tag key={tag.label} color={tag.color} style={{ margin: 0 }}>{tag.label}</Tag>
          ))}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          规则集每日自动更新（geosite-cn、geoip-cn、Netflix、YouTube 等）；AI 服务规则随订阅刷新更新
        </Typography.Text>
      </div>
    </Space>
  );
}
