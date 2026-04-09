'use client';

import { useState } from 'react';
import { App, Button, Table, Space, Card, Tag, Typography, Collapse, Empty, QRCode, Tabs, Input, Modal, Divider, Dropdown } from 'antd';
import type { ColumnType } from 'antd/es/table';
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
  /** Hiddify: the actual subscription URL (deep link is in url, this is the fallback V2Ray link) */
  extra?: string;
}

function getFormats(token: string): SubFormat[] {
  const base = `${window.location.origin}/api/subscriptions/link/${token}`;
  return [
    { key: 'hiddify', label: 'Hiddify（推荐）', url: `hiddify://import/${base}#NextPanel`, extra: base },
    { key: 'clash', label: 'Clash', url: `${base}/clash` },
    { key: 'homeproxy', label: 'HomeProxy (OpenWrt)', url: `${base}/homeproxy` },
    { key: 'v2ray', label: '通用', url: base },
  ];
}

function getShareFormats(shareToken: string): SubFormat[] {
  const base = `${window.location.origin}/api/subscriptions/share/${shareToken}`;
  return [
    { key: 'hiddify', label: 'Hiddify（推荐）', url: `hiddify://import/${base}#NextPanel`, extra: base },
    { key: 'clash', label: 'Clash', url: `${base}/clash` },
    { key: 'homeproxy', label: 'HomeProxy (OpenWrt)', url: `${base}/homeproxy` },
    { key: 'v2ray', label: '通用', url: base },
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
  const { isMobile, isTablet } = useIsMobile();
  const rows = buildNodeRows(sub);
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点" style={{ padding: '16px 0' }} />;
  }

  type Row = typeof rows[number];

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => (
          <Card key={row.id} size="small" style={{ borderRadius: 8 }}>
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
  if (isViewerResponse) {
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

const FORMAT_DESCRIPTIONS: Record<string, string> = {
  clash: '适合 Clash Verge / mihomo Party 等基于 mihomo 内核的客户端，支持多端口分流',
  v2ray: '适合 v2rayN、Shadowrocket 等客户端',
  homeproxy: '适合 OpenWrt 路由器上的 HomeProxy 插件，包含完整分流规则（广告屏蔽、AI 服务、流媒体、国内直连）',
};

function LinkTabs({ formats, onCopy }: { formats: SubFormat[]; onCopy: (url: string) => void }) {
  const { isMobile } = useIsMobile();
  const [showQr, setShowQr] = useState(isMobile);

  return (
    <Tabs
      defaultActiveKey="hiddify"
      items={formats.map((f) => ({
        key: f.key,
        label: f.label,
        children: f.key === 'hiddify' ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              推荐使用 Hiddify 客户端，全平台免费开源。支持 iOS / Android / Windows / macOS / Linux。
            </Typography.Text>
            <div style={{ textAlign: 'center' }}>
              <a href={f.url}>
                <Button type="primary" size="large" style={{ background: '#52c41a', borderColor: '#52c41a', fontWeight: 500, padding: '0 32px' }}>
                  一键导入 Hiddify
                </Button>
              </a>
            </div>
            {f.extra && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  订阅链接（手动添加时复制此链接）
                </Typography.Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Input value={f.extra} readOnly />
                  <Button onClick={() => onCopy(f.extra!)}>复制</Button>
                </Space.Compact>
              </div>
            )}
            {isMobile && f.extra && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <QRCode value={f.extra} size={160} />
              </div>
            )}
            {!isMobile && f.extra && (
              <div style={{ textAlign: 'center' }}>
                <Button type="link" size="small" onClick={() => setShowQr((v) => !v)}>
                  {showQr ? '收起二维码' : '显示二维码'}
                </Button>
                {showQr && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                    <QRCode value={f.extra} size={200} />
                  </div>
                )}
              </div>
            )}
            <div style={{ textAlign: 'center' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                下载 Hiddify：<Typography.Link href="https://hiddify.com" target="_blank">hiddify.com</Typography.Link>
              </Typography.Text>
            </div>
          </Space>
        ) : f.key === 'clash' ? (
          <ClashTab url={f.url} onCopy={onCopy} />
        ) : f.key === 'homeproxy' ? (
          <HomeProxyTab url={f.url} onCopy={onCopy} />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            {FORMAT_DESCRIPTIONS[f.key] && (
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                {FORMAT_DESCRIPTIONS[f.key]}
              </Typography.Text>
            )}
            <Space.Compact style={{ width: '100%' }}>
              <Input value={f.url} readOnly />
              <Button onClick={() => onCopy(f.url)}>复制</Button>
            </Space.Compact>
            {isMobile && (
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <QRCode value={f.url} size={160} />
              </div>
            )}
            {!isMobile && (
              <div style={{ textAlign: 'center' }}>
                <Button type="link" size="small" onClick={() => setShowQr((v) => !v)}>
                  {showQr ? '收起二维码' : '显示二维码'}
                </Button>
                {showQr && (
                  <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                    <QRCode value={f.url} size={200} />
                  </div>
                )}
              </div>
            )}
          </Space>
        ),
      }))}
    />
  );
}

function ClashTab({ url, onCopy }: { url: string; onCopy: (url: string) => void }) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {FORMAT_DESCRIPTIONS['clash']}
      </Typography.Text>
      <Space.Compact style={{ width: '100%' }}>
        <Input value={url} readOnly />
        <Button onClick={() => onCopy(url)}>复制</Button>
      </Space.Compact>

      {/* Multi-terminal routing guide */}
      <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 16px' }}>
        <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
          多终端分流
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
          订阅包含多个监听端口，不同终端设置不同端口即可走不同的代理策略组，在 Clash 面板中可独立选择每个组走哪个节点。
        </Typography.Text>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e8e8e8' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'rgba(0,0,0,0.45)' }}>端口</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'rgba(0,0,0,0.45)' }}>策略组</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'rgba(0,0,0,0.45)' }}>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '4px 8px' }}><Tag color="blue" style={{ margin: 0 }}>7890</Tag></td>
              <td style={{ padding: '4px 8px' }}>🚀 节点选择</td>
              <td style={{ padding: '4px 8px', color: 'rgba(0,0,0,0.45)' }}>默认端口，走规则分流</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '4px 8px' }}><Tag color="green" style={{ margin: 0 }}>7891+</Tag></td>
              <td style={{ padding: '4px 8px' }}>按地区分组</td>
              <td style={{ padding: '4px 8px', color: 'rgba(0,0,0,0.45)' }}>每个地区一个端口，按节点数量排序</td>
            </tr>
            <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: '4px 8px' }}><Tag color="purple" style={{ margin: 0 }}>7901</Tag></td>
              <td style={{ padding: '4px 8px' }}>🎬 流媒体</td>
              <td style={{ padding: '4px 8px', color: 'rgba(0,0,0,0.45)' }}>Netflix / YouTube 等</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px' }}><Tag color="purple" style={{ margin: 0 }}>7902</Tag></td>
              <td style={{ padding: '4px 8px' }}>🤖 AI 服务</td>
              <td style={{ padding: '4px 8px', color: 'rgba(0,0,0,0.45)' }}>OpenAI / Claude / Gemini 等</td>
            </tr>
          </tbody>
        </table>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
          终端使用示例：
        </Typography.Text>
        <Typography.Text code style={{ fontSize: 11, display: 'block', marginTop: 4, whiteSpace: 'pre-wrap' }}>
          {`# 终端 1 — 走默认规则分流\nexport https_proxy=http://127.0.0.1:7890\n\n# 终端 2 — 走指定地区（如日本 7891）\nexport https_proxy=http://127.0.0.1:7891\n\n# 终端 3 — 专走 AI 服务节点\nexport https_proxy=http://127.0.0.1:7902`}
        </Typography.Text>
      </div>
    </Space>
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

function HomeProxyTab({ url, onCopy }: { url: string; onCopy: (url: string) => void }) {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={20}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {FORMAT_DESCRIPTIONS['homeproxy']}
      </Typography.Text>

      {/* Download plugin */}
      <div>
        <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
          第一步：下载路由器插件
        </Typography.Text>
        <Space wrap>
          <Button
            type="primary"
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
        <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
          第二步：在插件中填入配置 URL
        </Typography.Text>
        <Space.Compact style={{ width: '100%' }}>
          <Input value={url} readOnly />
          <Button onClick={() => onCopy(url)}>复制</Button>
        </Space.Compact>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          包含完整分流规则，插件将自动定期拉取最新节点和规则
        </Typography.Text>
      </div>

      {/* Setup guide */}
      <div>
        <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
          安装步骤
        </Typography.Text>
        <ol style={{ paddingLeft: 20, margin: 0 }}>
          {HOMEPROXY_STEPS.map((step, i) => (
            <li key={i} style={{ marginBottom: 6, fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* Routing rules info */}
      <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 16px' }}>
        <Typography.Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
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
            <Tag key={tag.label} color={tag.color}>{tag.label}</Tag>
          ))}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          规则集每日自动更新（geosite-cn、geoip-cn、Netflix、YouTube 等）；AI 服务规则随订阅刷新更新
        </Typography.Text>
      </div>
    </Space>
  );
}
