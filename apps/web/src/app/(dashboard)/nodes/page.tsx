'use client';

import { useMemo, useState } from 'react';
import { App, Button, Table, Tag, Space, Switch, Dropdown, Typography, Collapse, Empty, Tooltip, theme as antdTheme } from 'antd';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ApiOutlined, ShareAltOutlined, FileTextOutlined, EditOutlined, CloudUploadOutlined, EllipsisOutlined, DeleteOutlined, GlobalOutlined, PlusOutlined } from '@ant-design/icons';
import ServerTagList from '@/components/servers/ServerTagList';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';
import NodePresetModal from '@/components/nodes/NodePresetModal';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import AppCard from '@/components/common/AppCard';
import EmptyState from '@/components/common/EmptyState';
import { TableSkeleton } from '@/components/common/skeletons';
import { statusColors } from '@/theme/semantic';
import { useThemeTokens } from '@/theme/ThemeContext';
import { useNodeActions } from '@/hooks/useNodeActions';
import type { Node, Server } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

/** 状态点脉冲动画（inline style 不支持 @keyframes，用 <style> 注入） */
const STATUS_DOT_CSS = `
.np-status-dot {
  transition: background-color 0.2s ease;
}
.np-status-dot-pulse {
  animation: np-status-dot-pulse 1.2s ease-in-out infinite;
}
@keyframes np-status-dot-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.6); opacity: 0.45; }
}
`;

/** 通用状态点：颜色取自语义色板；pulse 用于"测试中"等进行中状态 */
function StatusDot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={pulse ? 'np-status-dot np-status-dot-pulse' : 'np-status-dot'}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

/** 服务器状态 → 语义色 */
function serverStatusColor(status: string): string {
  if (status === 'ONLINE') return statusColors.success;
  if (status === 'OFFLINE' || status === 'ERROR') return statusColors.error;
  if (status === 'DELETING') return statusColors.warning;
  return statusColors.neutral;
}

function formatBytes(bytes: number, hasStats: boolean): string {
  if (!hasStats) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function formatTimeAgo(isoString: string | null): string {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export default function NodesPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { token } = antdTheme.useToken();
  const tokens = useThemeTokens();

  // Modals
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [presetServerId, setPresetServerId] = useState<string | undefined>(undefined);

  // Collapse state: track collapsed server IDs
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);

  const { isMobile, isTablet } = useIsMobile();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then((r) => r.data),
    staleTime: 2 * 60 * 1000,
  });

  const { data: servers, isLoading: serversLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data),
    refetchInterval: 30_000,
  });

  if (isError) message.error('加载节点失败');

  const nodes = data ?? [];
  const nodeActions = useNodeActions({ nodes });
  const {
    testResults,
    testingId,
    batchTesting,
    batchProgress,
    togglingId,
    openDeploy,
    openDelete,
    openRename,
    openEgressPolicy,
  } = nodeActions;
  const testMutation = { mutate: nodeActions.testNode };
  const toggleMutation = { mutate: nodeActions.toggleNode };
  const setShareNode = nodeActions.openShare;
  const setLogNode = nodeActions.openLogs;

  // Group nodes by server
  const groups = useMemo(() => {
    if (!servers) return [];
    const nodesByServer = new Map<string, Node[]>();
    for (const node of nodes) {
      const arr = nodesByServer.get(node.serverId) ?? [];
      arr.push(node);
      nodesByServer.set(node.serverId, arr);
    }
    return servers.map((server) => ({
      server,
      nodes: nodesByServer.get(server.id) ?? [],
    }));
  }, [servers, nodes]);
  // All servers expanded by default; track collapsed ones
  const activeKeys = useMemo(
    () => groups.map((g) => g.server.id).filter((id) => !collapsedIds.includes(id)),
    [groups, collapsedIds],
  );

  function openPresetForServer(serverId: string) {
    setPresetServerId(serverId);
    setPresetModalOpen(true);
  }

  const columns: ColumnType<Node>[] = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (_: unknown, r: Node) => (
        <Space size={4}>
          <span>{r.name}</span>
          {r.exitServer && <Tag color="purple" style={{ margin: 0 }}>链式 → {r.exitServer.name}</Tag>}
          {r.exitType === 'SOCKS5' && (
            <Tag color="cyan" style={{ margin: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              链式 → {r.socksExitName ?? 'SOCKS5'}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '协议',
      render: (_: unknown, r) => (
        <Space size={4}>
          <Tag color="blue">{r.protocol}</Tag>
          {r.transport && <Tag>{r.transport}</Tag>}
          {r.tls !== 'NONE' && <Tag color="green">{r.tls}</Tag>}
          {r.egressIpPolicy === 'IPV4_ONLY' && <Tag color="green">IPv4</Tag>}
        </Space>
      ),
    },
    { title: '端口', dataIndex: 'listenPort', width: 80 },
    {
      title: '状态',
      width: 90,
      render: (_: unknown, r) => <StatusTag status={r.status} enabled={r.enabled} />,
    },
    {
      title: '启用',
      width: 70,
      render: (_: unknown, r) => (
        <Switch
          size="small"
          checked={r.enabled}
          loading={togglingId === r.id}
          onChange={() => toggleMutation.mutate(r.id)}
        />
      ),
    },
    {
      title: <Tooltip title="自上次部署/重启起累计上传流量">↑上传</Tooltip>,
      width: 90,
      render: (_: unknown, r) => formatBytes(r.trafficUpBytes, r.statsPort !== null),
    },
    {
      title: <Tooltip title="自上次部署/重启起累计下载流量">↓下载</Tooltip>,
      width: 90,
      render: (_: unknown, r) => formatBytes(r.trafficDownBytes, r.statsPort !== null),
    },
    {
      title: '连通性',
      width: 90,
      render: (_: unknown, r) => {
        const sessionResult = testResults[r.id];
        const isTestingThis = testingId === r.id || (batchTesting && !sessionResult);

        if (isTestingThis) {
          return (
            <Space size={6}>
              <StatusDot color={statusColors.info} pulse />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>测试中</Typography.Text>
            </Space>
          );
        }

        if (sessionResult) {
          if (sessionResult.reachable) {
            return (
              <Space direction="vertical" size={2}>
                <Space size={6}>
                  <StatusDot color={statusColors.success} />
                  <Tag color="green" style={{ marginRight: 0 }}>{sessionResult.latency}ms</Tag>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatTimeAgo(sessionResult.testedAt)}</Typography.Text>
              </Space>
            );
          }
          return (
            <Space size={6}>
              <StatusDot color={statusColors.error} />
              <Tag color="red" style={{ marginRight: 0 }}>失败</Tag>
            </Space>
          );
        }

        if (r.lastTestedAt) {
          if (r.lastReachable) {
            return (
              <Space direction="vertical" size={2}>
                <Space size={6}>
                  <StatusDot color={statusColors.success} />
                  <Tag color="green" style={{ marginRight: 0 }}>{r.lastLatency}ms</Tag>
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatTimeAgo(r.lastTestedAt)}</Typography.Text>
              </Space>
            );
          }
          return (
            <Space direction="vertical" size={2}>
              <Space size={6}>
                <StatusDot color={statusColors.error} />
                <Tag color="red" style={{ marginRight: 0 }}>失败</Tag>
              </Space>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>{formatTimeAgo(r.lastTestedAt)}</Typography.Text>
            </Space>
          );
        }

        return <Tag>未测试</Tag>;
      },
    },
    {
      title: '操作',
      width: isMobile ? 48 : 160,
      render: (_: unknown, record) => {
        const moreItems = [
          {
            key: 'deploy',
            icon: <CloudUploadOutlined />,
            label: '部署',
            onClick: () => openDeploy(record),
          },
          {
            key: 'log',
            icon: <FileTextOutlined />,
            label: '日志',
            onClick: () => setLogNode(record),
          },
          {
            key: 'egress-policy',
            icon: <GlobalOutlined />,
            label: '出口 IP 策略',
            disabled: (record.implementation ?? 'XRAY') !== 'XRAY',
            onClick: () => openEgressPolicy(record),
          },
          {
            key: 'rename',
            icon: <EditOutlined />,
            label: '重命名',
            onClick: () => openRename(record),
          },
          { type: 'divider' as const },
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: '删除',
            danger: true,
            onClick: () => {
              modal.confirm({
                title: '确认删除该节点？',
                content: '将同步停止并移除代理服务器上的对应服务',
                okText: '删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: () => openDelete(record),
              });
            },
          },
        ];

        if (isMobile) {
          return (
            <Dropdown
              menu={{
                items: [
                  { key: 'share', icon: <ShareAltOutlined />, label: '分享', onClick: () => setShareNode(record) },
                  { key: 'test', icon: <ApiOutlined />, label: '测试', onClick: () => testMutation.mutate(record.id) },
                  ...moreItems,
                ],
              }}
              trigger={['click']}
            >
              <Button size="small" icon={<EllipsisOutlined />} />
            </Dropdown>
          );
        }

        return (
          <Space size={4}>
            <Button
              size="small"
              icon={<ShareAltOutlined />}
              onClick={() => setShareNode(record)}
            >
              分享
            </Button>
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={testingId === record.id}
              onClick={() => testMutation.mutate(record.id)}
            >
              测试
            </Button>
            <Dropdown menu={{ items: moreItems }} trigger={['click']}>
              <Button size="small" icon={<EllipsisOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [isMobile, testResults, testingId, batchTesting, togglingId, toggleMutation, testMutation, modal, openDeploy, openDelete, openRename, openEgressPolicy]);

  // Tablet: hide low-priority columns; mobile uses card layout (table not rendered)
  const TABLET_KEEP_COLUMNS = new Set(['名称', '协议', '状态', '启用', '连通性', '操作']);
  const visibleColumns = isTablet
    ? columns.filter((c) => typeof c.title === 'string' && TABLET_KEEP_COLUMNS.has(c.title))
    : columns;

  const batchTestButton = (
    <Button
      icon={<ApiOutlined />}
      loading={batchTesting}
      onClick={() => void nodeActions.startBatchTest()}
    >
      {!isMobile && (batchTesting && batchProgress
        ? `测试中 ${batchProgress.done}/${batchProgress.total}`
        : '批量测试')}
    </Button>
  );

  const collapseItems = groups.map(({ server, nodes: serverNodes }) => ({
    key: server.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, flexWrap: 'wrap', rowGap: 4 }}>
        {/* 主标题：国旗 + 服务器名 */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {server.countryCode && (
            <span
              className={`fi fi-${server.countryCode.toLowerCase()} fis`}
              style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }}
            />
          )}
          <span
            style={{
              fontWeight: 600,
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {server.name}
          </span>
        </span>
        {/* 状态点与状态标签对齐 */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <StatusDot color={serverStatusColor(server.status)} pulse={server.status === 'DELETING'} />
          <StatusTag status={server.status} />
        </span>
        {/* 次要信息：IP / 区域 / 节点数 */}
        {!isMobile && (
          <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
            {[server.ip, server.region, `${serverNodes.length} 个节点`].filter(Boolean).join(' · ')}
          </Typography.Text>
        )}
        {!isMobile && (server.tags.length > 0 || (server.autoTags ?? []).length > 0) && (
          <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
            <ServerTagList tags={server.tags} autoTags={server.autoTags ?? []} readonly />
          </span>
        )}
        <div style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => openPresetForServer(server.id)}
          >
            {!isMobile && '新增节点'}
          </Button>
        </div>
      </div>
    ),
    children: serverNodes.length === 0 ? (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            暂无节点，
            <a onClick={() => openPresetForServer(server.id)}>点击新增</a>
          </span>
        }
        style={{ padding: '16px 0' }}
      />
    ) : isMobile ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {serverNodes.map((node) => {
          const sessionResult = testResults[node.id];
          const isTestingThis = testingId === node.id || (batchTesting && !sessionResult);
          const connectivityEl = isTestingThis ? (
            <Space size={6}>
              <StatusDot color={statusColors.info} pulse />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>测试中</Typography.Text>
            </Space>
          ) : sessionResult ? (
            sessionResult.reachable
              ? (
                <Space size={6}>
                  <StatusDot color={statusColors.success} />
                  <Tag color="green" style={{ margin: 0 }}>{sessionResult.latency}ms</Tag>
                </Space>
              )
              : (
                <Space size={6}>
                  <StatusDot color={statusColors.error} />
                  <Tag color="red" style={{ margin: 0 }}>失败</Tag>
                </Space>
              )
          ) : node.lastTestedAt ? (
            node.lastReachable
              ? (
                <Space size={6}>
                  <StatusDot color={statusColors.success} />
                  <Tag color="green" style={{ margin: 0 }}>{node.lastLatency}ms</Tag>
                </Space>
              )
              : (
                <Space size={6}>
                  <StatusDot color={statusColors.error} />
                  <Tag color="red" style={{ margin: 0 }}>失败</Tag>
                </Space>
              )
          ) : (
            <Tag style={{ margin: 0 }}>未测试</Tag>
          );

          const moreItems = [
            { key: 'deploy', icon: <CloudUploadOutlined />, label: '部署', onClick: () => openDeploy(node) },
            { key: 'log', icon: <FileTextOutlined />, label: '日志', onClick: () => setLogNode(node) },
            { key: 'rename', icon: <EditOutlined />, label: '重命名', onClick: () => openRename(node) },
            { type: 'divider' as const },
            {
              key: 'delete',
              icon: <DeleteOutlined />,
              label: '删除',
              danger: true,
              onClick: () => modal.confirm({
                title: '确认删除该节点？',
                content: '将同步停止并移除代理服务器上的对应服务',
                okText: '删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: () => openDelete(node),
              }),
            },
          ];

          return (
            <AppCard key={node.id} size="small" hoverable style={{ borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, overflow: 'hidden' }}>
                <Space size={4} style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
                  <Typography.Text strong style={{ fontSize: 14 }} ellipsis>{node.name}</Typography.Text>
                  {node.exitServer && <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>链式</Tag>}
                  {node.exitType === 'SOCKS5' && <Tag color="cyan" style={{ margin: 0, fontSize: 11 }}>SOCKS5</Tag>}
                </Space>
                <StatusTag status={node.status} enabled={node.enabled} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                <Tag color="blue" style={{ margin: 0 }}>{node.protocol}</Tag>
                {node.transport && <Tag style={{ margin: 0 }}>{node.transport}</Tag>}
                {node.tls !== 'NONE' && <Tag color="green" style={{ margin: 0 }}>{node.tls}</Tag>}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>:{node.listenPort}</Typography.Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space size={8}>
                  <Switch
                    size="small"
                    checked={node.enabled}
                    loading={togglingId === node.id}
                    onChange={() => toggleMutation.mutate(node.id)}
                  />
                  {connectivityEl}
                </Space>
                <Space size={4}>
                  <Button size="small" icon={<ShareAltOutlined />} onClick={() => setShareNode(node)} />
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    loading={testingId === node.id}
                    onClick={() => testMutation.mutate(node.id)}
                  />
                  <Dropdown menu={{ items: moreItems }} trigger={['click']}>
                    <Button size="small" icon={<EllipsisOutlined />} />
                  </Dropdown>
                </Space>
              </div>
            </AppCard>
          );
        })}
      </div>
    ) : (
      <Table
        rowKey="id"
        size="middle"
        dataSource={serverNodes}
        columns={visibleColumns}
        scroll={isTablet ? undefined : { x: 'max-content' }}
        pagination={serverNodes.length > 10 ? { showTotal: (total) => `共 ${total} 条` } : false}
      />
    ),
  }));

  // 分组面板容器：token 化描边/背景/阴影 + hover 过渡（值随主题切换重渲染）
  const collapseCss = `
.np-nodes-collapse .ant-collapse-item {
  border: 1px solid ${token.colorBorderSecondary};
  border-radius: 10px !important;
  margin-bottom: 12px;
  overflow: hidden;
  background: ${token.colorBgContainer};
  box-shadow: ${tokens.cardShadow};
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.np-nodes-collapse .ant-collapse-item:last-child {
  margin-bottom: 0;
}
.np-nodes-collapse .ant-collapse-header {
  transition: background-color 0.2s ease;
}
.np-nodes-collapse .ant-collapse-item:not(.ant-collapse-item-active) .ant-collapse-header:hover {
  background-color: ${token.colorFillTertiary};
}
`;

  const firstLoading = isLoading || serversLoading;

  return (
    <AppCard>
      <style>{STATUS_DOT_CSS + collapseCss}</style>
      <PageHeader
        title="节点管理"
        addLabel="新增节点"
        onAdd={() => {
          setPresetServerId(undefined);
          setPresetModalOpen(true);
        }}
        extra={batchTestButton}
      />
      {firstLoading ? (
        <TableSkeleton rows={8} />
      ) : nodes.length === 0 ? (
        <EmptyState
          title="暂无节点"
          description="创建你的第一个代理节点，或在对应服务器分组中批量添加"
          actionLabel="新增节点"
          onAction={() => {
            setPresetServerId(undefined);
            setPresetModalOpen(true);
          }}
        />
      ) : (
        <Collapse
          className="np-nodes-collapse"
          activeKey={activeKeys}
          onChange={(keys) => {
            const activeSet = new Set(Array.isArray(keys) ? keys : [keys]);
            setCollapsedIds(groups.map((g) => g.server.id).filter((id) => !activeSet.has(id)));
          }}
          items={collapseItems}
          style={{ background: 'transparent', border: 'none' }}
        />
      )}

      <NodePresetModal
        open={presetModalOpen}
        onClose={() => {
          setPresetModalOpen(false);
          setPresetServerId(undefined);
        }}
        onSuccess={(node) => {
          setPresetModalOpen(false);
          setPresetServerId(undefined);
          qc.invalidateQueries({ queryKey: ['nodes'] });
          nodeActions.openDeploy(node);
        }}
        defaultServerId={presetServerId}
      />

      {nodeActions.modals}
    </AppCard>
  );
}
