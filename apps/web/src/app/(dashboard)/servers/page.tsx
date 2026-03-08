'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import {
  App,
  Button,
  Table,
  Tag,
  Space,
  Card,
  Tooltip,
  Popover,
  Dropdown,
  Input,
  Select,
  Typography,
  Row,
  Col,
  Alert,
} from 'antd';
import {
  AppstoreOutlined,
  BarsOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  SyncOutlined,
  UpCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { serversApi, agentApi } from '@/lib/api';
import ServerFormModal from '@/components/servers/ServerFormModal';
import AgentInstallDrawer from '@/components/servers/AgentInstallDrawer';
import AutoSetupDrawer from '@/components/servers/AutoSetupDrawer';
import ServerCard from '@/components/servers/ServerCard';
import PageHeader from '@/components/common/PageHeader';
import StatusTag from '@/components/common/StatusTag';
import type { Server } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;

function formatRate(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1024 / 1024).toFixed(1)} MB/s`;
}

function usageColor(pct: number | null | undefined): string {
  if (pct == null) return '#1677ff';
  if (pct < 70) return '#52c41a';
  if (pct < 90) return '#faad14';
  return '#ff4d4f';
}

function GfwDot({ gfwBlocked }: { gfwBlocked: boolean | null }) {
  const color = gfwBlocked === false ? '#52c41a' : gfwBlocked === true ? '#ff4d4f' : '#d9d9d9';
  const label = gfwBlocked === false ? '未被封锁' : gfwBlocked === true ? '已被封锁' : 'GFW 未检测';
  return (
    <Tooltip title={label}>
      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
    </Tooltip>
  );
}

function heartbeatColor(lastSeenAt: string | null): string {
  if (!lastSeenAt) return '#8c8c8c';
  const diffMin = dayjs().diff(dayjs(lastSeenAt), 'minute');
  if (diffMin <= 5) return '#52c41a';
  if (diffMin <= 30) return '#faad14';
  return '#ff4d4f';
}

export default function ServersPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Server | null>(null);
  const [installTarget, setInstallTarget] = useState<Server | null>(null);
  const [autoSetupTarget, setAutoSetupTarget] = useState<{ server: Server; templateIds: string[] } | null>(null);

  // 视图模式
  const [viewMode, setViewMode] = useState<'table' | 'card'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('servers_view_mode') as 'table' | 'card') ?? 'table';
    }
    return 'table';
  });

  const switchView = (mode: 'table' | 'card') => {
    setViewMode(mode);
    localStorage.setItem('servers_view_mode', mode);
  };

  // 批量选择
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [bulkTestingIds, setBulkTestingIds] = useState<Set<string>>(new Set());

  // 筛选状态
  const [searchText, setSearchText] = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [tagsFilter, setTagsFilter] = useState<string[]>([]);
  const [regionFilter, setRegionFilter] = useState<string | undefined>(undefined);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as Server[]),
    refetchInterval: 30_000,
  });

  const { data: latestAgent } = useQuery({
    queryKey: ['agent-latest-version'],
    queryFn: () => agentApi.latestVersion().then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  });

  const agentUpdateMutation = useMutation({
    mutationFn: (id: string) => agentApi.update(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      message.success('更新指令已下发，Agent 将在下次心跳时开始更新');
    },
    onError: () => message.error('下发更新指令失败'),
  });

  const agentUpdateBatchMutation = useMutation({
    mutationFn: (ids: string[]) => agentApi.updateBatch(ids),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      message.success(`已向 ${res.data.count} 台服务器下发更新指令`);
    },
    onError: () => message.error('批量下发更新指令失败'),
  });

  // Auto-open AgentInstallDrawer when navigated here with ?install=<id>
  useEffect(() => {
    if (!data) return;
    const installId = new URLSearchParams(window.location.search).get('install');
    if (!installId) return;
    const server = data.find((s) => s.id === installId);
    if (server) {
      setInstallTarget(server);
      router.replace('/servers');
    }
  }, [data, router]);
  if (isError) message.error('加载服务器失败');

  const deleteMutation = useMutation({
    mutationFn: (id: string) => serversApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      message.info('正在清理服务器，请稍候...');
    },
    onError: () => message.error('删除失败'),
  });

  const forceDeleteMutation = useMutation({
    mutationFn: (id: string) => serversApi.delete(id, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      message.success('服务器已强制删除');
    },
    onError: () => message.error('强制删除失败'),
  });

  const [testingSshId, setTestingSshId] = useState<string | null>(null);
  const testSshMutation = useMutation({
    mutationFn: (id: string) => {
      setTestingSshId(id);
      return serversApi.testSsh(id);
    },
    onSuccess: (res) => {
      if (res.data.success) message.success('SSH 连接成功');
      else message.error(`SSH 连接失败: ${res.data.message}`);
    },
    onSettled: () => setTestingSshId(null),
  });

  const handleDelete = (record: Server) =>
    modal.confirm({
      title: '确认删除该服务器？',
      content: `将删除「${record.name}」及其所有节点，此操作不可撤销。`,
      okText: '删除',
      okType: 'danger',
      onOk: () => deleteMutation.mutate(record.id),
    });

  const handleForceDelete = (record: Server) => {
    const failures: { nodeName: string; error: string }[] = record.deleteError
      ? JSON.parse(record.deleteError) as { nodeName: string; error: string }[]
      : [];
    modal.confirm({
      title: '强制删除服务器？',
      content: (
        <div>
          <p>以下节点的服务未能从服务器上清理，仍可能在后台运行：</p>
          <ul style={{ paddingLeft: 16, margin: '8px 0' }}>
            {failures.map((f) => (
              <li key={f.nodeName} style={{ fontSize: 12, color: '#ff4d4f' }}>
                <strong>{f.nodeName}</strong>：{f.error}
              </li>
            ))}
          </ul>
          <p>强制删除将仅删除面板记录，不会清理服务器上的残留服务。</p>
        </div>
      ),
      okText: '确认强制删除',
      okType: 'danger',
      onOk: () => forceDeleteMutation.mutate(record.id),
    });
  };

  const handleEdit = (record: Server) => {
    setEditTarget(record);
    setModalOpen(true);
  };

  // 批量删除
  const handleBulkDelete = () => {
    modal.confirm({
      title: `确认删除 ${selectedRowKeys.length} 台服务器？`,
      content: '将异步清理节点并删除记录，此操作不可撤销。',
      okText: '删除',
      okType: 'danger',
      onOk: async () => {
        await Promise.allSettled(selectedRowKeys.map((id) => serversApi.delete(id)));
        qc.invalidateQueries({ queryKey: ['servers'] });
        setSelectedRowKeys([]);
        message.info('正在清理服务器，请稍候...');
      },
    });
  };

  // 批量测试 SSH
  const handleBulkTestSsh = async () => {
    const ids = [...selectedRowKeys];
    setBulkTestingIds(new Set(ids));
    const results = await Promise.allSettled(ids.map((id) => serversApi.testSsh(id)));
    setBulkTestingIds(new Set());
    const succeeded = results.filter(
      (r) => r.status === 'fulfilled' && r.value.data.success,
    ).length;
    message.info(`SSH 测试完成：${succeeded} 台成功，${ids.length - succeeded} 台失败`);
  };

  // 动态聚合可选标签和区域
  const allTags = useMemo(() => {
    const set = new Set<string>();
    data?.forEach((s) => s.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [data]);

  const allRegions = useMemo(() => {
    const set = new Set<string>();
    data?.forEach((s) => { if (s.region) set.add(s.region); });
    return [...set].sort();
  }, [data]);

  // 前端过滤
  const filteredData = useMemo(() => {
    if (!data) return [];
    return data.filter((s) => {
      const q = searchText.toLowerCase();
      const matchSearch = !q || s.name.toLowerCase().includes(q) || s.ip.includes(q);
      const matchStatus = !statusFilter || s.status === statusFilter;
      const matchTags = tagsFilter.length === 0 || tagsFilter.every((t) => s.tags.includes(t));
      const matchRegion = !regionFilter || s.region === regionFilter;
      return matchSearch && matchStatus && matchTags && matchRegion;
    });
  }, [data, searchText, statusFilter, tagsFilter, regionFilter]);

  const upgradableIds = useMemo(() => {
    if (!data || !latestAgent?.version) return [];
    return data
      .filter((s) => s.agentVersion && s.agentVersion !== latestAgent.version && !s.pendingAgentUpdate)
      .map((s) => s.id);
  }, [data, latestAgent]);

  const handleBulkAgentUpdate = () => {
    modal.confirm({
      title: `确认升级 ${upgradableIds.length} 台服务器的 Agent？`,
      content: `将从 当前版本 升级到 v${latestAgent?.version}，升级在后台完成，无需 SSH 窗口。`,
      okText: '确认升级',
      onOk: () => agentUpdateBatchMutation.mutate(upgradableIds),
    });
  };

  const columns: ColumnType<Server>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      render: (name, record) => (
        <Space direction="vertical" size={0} style={{ maxWidth: '100%' }}>
          <Space size={6} style={{ flexWrap: 'nowrap', overflow: 'hidden' }}>
            {record.countryCode && (
              <span
                className={`fi fi-${record.countryCode.toLowerCase()} fis`}
                style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0 }}
              />
            )}
            <Tooltip title={name}>
              <a onClick={() => router.push(`/servers/${record.id}`)} style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {name}
              </a>
            </Tooltip>
            {record.notes && (
              <Tooltip title={record.notes}>
                <FileTextOutlined style={{ color: '#8c8c8c', fontSize: 12, flexShrink: 0 }} />
              </Tooltip>
            )}
          </Space>
          <Space size={4}>
            <small style={{ color: '#888' }}>{record.ip}</small>
            <GfwDot gfwBlocked={record.ipCheck?.gfwBlocked ?? null} />
          </Space>
        </Space>
      ),
    },
    { title: '区域', dataIndex: 'region', width: 100, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      render: (status: string, record) => (
        <Space direction="vertical" size={2}>
          <StatusTag status={status} />
          <Text style={{ fontSize: 11, color: heartbeatColor(record.lastSeenAt) }}>
            {record.lastSeenAt ? dayjs(record.lastSeenAt).fromNow() : '从未连接'}
          </Text>
        </Space>
      ),
    },
    {
      title: '资源',
      width: 120,
      render: (_: unknown, record) =>
        record.cpuUsage != null ? (
          <Space direction="vertical" size={2}>
            {(['cpuUsage', 'memUsage', 'diskUsage'] as const).map((key) => {
              const labels: Record<string, string> = { cpuUsage: 'CPU', memUsage: '内存', diskUsage: '磁盘' };
              const val = record[key];
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 11, color: '#8c8c8c', width: 24, flexShrink: 0 }}>{labels[key]}</Text>
                  <Text style={{ fontSize: 12, fontWeight: 500, color: usageColor(val) }}>
                    {val != null ? `${Math.round(val)}%` : '—'}
                  </Text>
                </div>
              );
            })}
          </Space>
        ) : (
          <span style={{ color: '#ccc' }}>—</span>
        ),
    },
    {
      title: '网络',
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
          <span style={{ color: '#52c41a' }}>↑ {formatRate(record.networkOut)}</span>
          <span style={{ color: '#1677ff' }}>↓ {formatRate(record.networkIn)}</span>
        </Space>
      ),
    },
    {
      title: '延迟',
      render: (_: unknown, record) => {
        const ms = record.pingMs;
        if (ms == null) return <span style={{ color: '#ccc' }}>—</span>;
        const color = ms <= 50 ? '#52c41a' : ms <= 150 ? '#faad14' : '#ff4d4f';
        return <span style={{ color, fontWeight: 500 }}>{ms} ms</span>;
      },
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>),
    },
    {
      title: 'Agent',
      width: 120,
      render: (_: unknown, record) => {
        if (!record.agentVersion) return <span style={{ color: '#ccc' }}>—</span>;

        const isOutdated = latestAgent?.version && record.agentVersion !== latestAgent.version;
        const isPending = record.pendingAgentUpdate;

        if (isPending) {
          return (
            <Space size={4}>
              <SyncOutlined spin style={{ color: '#1677ff', fontSize: 12 }} />
              <span style={{ fontSize: 12, color: '#1677ff' }}>更新中...</span>
            </Space>
          );
        }

        return (
          <Space size={4}>
            <span style={{ fontSize: 12, color: isOutdated ? '#faad14' : '#8c8c8c' }}>
              v{record.agentVersion}
            </span>
            {isOutdated && latestAgent && (
              <>
                <Popover
                  title={`v${latestAgent.version} 更新内容`}
                  content={
                    <div style={{ maxWidth: 320, whiteSpace: 'pre-wrap', fontSize: 12 }}>
                      {latestAgent.releaseNotes || '暂无更新说明'}
                    </div>
                  }
                  trigger="click"
                >
                  <InfoCircleOutlined style={{ fontSize: 11, color: '#8c8c8c', cursor: 'pointer' }} />
                </Popover>
                <Tooltip title={`升级到 v${latestAgent.version}`}>
                  <Button
                    type="link"
                    size="small"
                    icon={<UpCircleOutlined />}
                    style={{ padding: 0, height: 'auto', fontSize: 12, color: '#1677ff' }}
                    loading={agentUpdateMutation.isPending}
                    onClick={() => agentUpdateMutation.mutate(record.id)}
                  />
                </Tooltip>
              </>
            )}
          </Space>
        );
      },
    },
    {
      title: '操作',
      render: (_: unknown, record) => {
        if (record.status === 'DELETING') {
          return <Text type="secondary" style={{ fontSize: 12 }}>删除中，请稍候...</Text>;
        }
        if (record.status === 'ERROR' && record.deleteError) {
          return (
            <Space>
              <Button size="small" danger onClick={() => handleDelete(record)}>重试删除</Button>
              <Button size="small" onClick={() => handleForceDelete(record)}>强制删除</Button>
            </Space>
          );
        }
        return (
          <Space>
            <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
              编辑
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'ssh',
                    icon: <CheckCircleOutlined />,
                    label: testingSshId === record.id ? '测试中...' : '测试 SSH',
                    disabled: testingSshId === record.id,
                    onClick: () => testSshMutation.mutate(record.id),
                  },
                  {
                    key: 'install',
                    icon: <CloudDownloadOutlined />,
                    label: '安装 / 更新 Agent',
                    onClick: () => setInstallTarget(record),
                  },
                  { type: 'divider' },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: '删除',
                    danger: true,
                    onClick: () => handleDelete(record),
                  },
                ],
              }}
            >
              <Button size="small" icon={<MoreOutlined />} />
            </Dropdown>
          </Space>
        );
      },
    },
  ];

  const viewToggle = (
    <Space>
      <Button
        size="small"
        type={viewMode === 'table' ? 'primary' : 'default'}
        icon={<BarsOutlined />}
        onClick={() => switchView('table')}
      />
      <Button
        size="small"
        type={viewMode === 'card' ? 'primary' : 'default'}
        icon={<AppstoreOutlined />}
        onClick={() => switchView('card')}
      />
    </Space>
  );

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader
        title="服务器管理"
        addLabel="新增服务器"
        onAdd={() => { setEditTarget(null); setModalOpen(true); }}
        extra={viewToggle}
      />

      {/* 搜索与筛选栏 */}
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="搜索名称或 IP"
          allowClear
          style={{ width: 200 }}
          onChange={(e) => {
            const value = e.target.value;
            if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
            searchTimerRef.current = setTimeout(() => setSearchText(value), 300);
          }}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 120 }}
          onChange={(v) => setStatusFilter(v)}
          options={[
            { value: 'ONLINE', label: '在线' },
            { value: 'OFFLINE', label: '离线' },
            { value: 'UNKNOWN', label: '未知' },
            { value: 'ERROR', label: '异常' },
          ]}
        />
        <Select
          mode="multiple"
          placeholder="标签筛选"
          allowClear
          style={{ minWidth: 150 }}
          onChange={(v) => setTagsFilter(v)}
          options={allTags.map((t) => ({ value: t, label: t }))}
        />
        <Select
          placeholder="区域"
          allowClear
          style={{ width: 120 }}
          onChange={(v) => setRegionFilter(v)}
          options={allRegions.map((r) => ({ value: r, label: r }))}
        />
      </Space>

      {/* 批量操作栏 */}
      {selectedRowKeys.length > 0 && (
        <Alert
          style={{ marginBottom: 12 }}
          message={
            <Space>
              <span>已选 {selectedRowKeys.length} 台服务器</span>
              <Button
                size="small"
                icon={<CheckCircleOutlined />}
                loading={bulkTestingIds.size > 0}
                onClick={handleBulkTestSsh}
              >
                批量测试 SSH
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={handleBulkDelete}
              >
                批量删除
              </Button>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          }
          type="info"
          showIcon={false}
        />
      )}

      {/* Agent 可升级提示 */}
      {upgradableIds.length > 0 && (
        <Alert
          style={{ marginBottom: 12 }}
          message={
            <Space>
              <span>
                <UpCircleOutlined style={{ color: '#faad14' }} /> {upgradableIds.length} 台服务器的 Agent 可升级到 v{latestAgent?.version}
              </span>
              <Button
                size="small"
                icon={<SyncOutlined />}
                loading={agentUpdateBatchMutation.isPending}
                onClick={handleBulkAgentUpdate}
              >
                一键升级全部
              </Button>
            </Space>
          }
          type="warning"
          showIcon={false}
        />
      )}

      {/* 表格视图 */}
      {viewMode === 'table' && (
        <Table
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={filteredData}
          columns={columns}
          scroll={{ x: 'max-content' }}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as string[]),
          }}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
        />
      )}

      {/* 卡片视图 */}
      {viewMode === 'card' && (
        <Row gutter={[16, 16]}>
          {filteredData.map((server) => (
            <Col key={server.id} xs={24} sm={12} lg={8} xl={6}>
              <ServerCard
                server={server}
                testingSsh={testingSshId === server.id || bulkTestingIds.has(server.id)}
                onEdit={handleEdit}
                onInstall={setInstallTarget}
                onDelete={handleDelete}
                onForceDelete={handleForceDelete}
                onTestSsh={(s) => testSshMutation.mutate(s.id)}
              />
            </Col>
          ))}
        </Row>
      )}

      <ServerFormModal
        open={modalOpen}
        initialValues={editTarget as Record<string, unknown> | null}
        onClose={() => setModalOpen(false)}
        onSuccess={(server, templateIds) => {
          setModalOpen(false);
          qc.invalidateQueries({ queryKey: ['servers'] });
          if (!editTarget && server) {
            if (templateIds && templateIds.length > 0) {
              setAutoSetupTarget({ server: server as Server, templateIds });
            } else {
              setInstallTarget(server as Server);
            }
          }
        }}
      />

      {installTarget && (
        <AgentInstallDrawer
          open={!!installTarget}
          serverId={installTarget.id}
          serverName={installTarget.name}
          onClose={() => setInstallTarget(null)}
        />
      )}

      {autoSetupTarget && (
        <AutoSetupDrawer
          open={!!autoSetupTarget}
          serverId={autoSetupTarget.server.id}
          serverName={autoSetupTarget.server.name}
          templateIds={autoSetupTarget.templateIds}
          onClose={() => { setAutoSetupTarget(null); qc.invalidateQueries({ queryKey: ['servers'] }); }}
        />
      )}
    </Card>
  );
}
