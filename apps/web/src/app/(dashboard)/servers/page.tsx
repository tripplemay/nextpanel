'use client';

import { useMemo, useState } from 'react';
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
  MoreOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { serversApi } from '@/lib/api';
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
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [tagsFilter, setTagsFilter] = useState<string[]>([]);
  const [regionFilter, setRegionFilter] = useState<string | undefined>(undefined);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as Server[]),
    refetchInterval: 10_000,
  });
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

  const columns: ColumnType<Server>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (name, record) => (
        <Space direction="vertical" size={0}>
          <Space size={4}>
            <a onClick={() => router.push(`/servers/${record.id}`)} style={{ fontWeight: 600 }}>
              {name}
            </a>
            {record.notes && (
              <Tooltip title={record.notes}>
                <FileTextOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
              </Tooltip>
            )}
          </Space>
          <small style={{ color: '#888' }}>{record.ip}</small>
        </Space>
      ),
    },
    { title: '区域', dataIndex: 'region' },
    { title: '提供商', dataIndex: 'provider' },
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
      title: 'CPU / 内存 / 磁盘',
      render: (_: unknown, record) =>
        record.cpuUsage != null ? (
          <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
            <span>CPU&nbsp;&nbsp;{record.cpuUsage.toFixed(1)}%</span>
            <span>内存&nbsp;&nbsp;{record.memUsage?.toFixed(1) ?? '—'}%</span>
            <span>磁盘&nbsp;&nbsp;{record.diskUsage?.toFixed(1) ?? '—'}%</span>
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
      title: 'Agent 版本',
      dataIndex: 'agentVersion',
      render: (v: string | null) => v ?? <span style={{ color: '#ccc' }}>未连接</span>,
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>),
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
          onChange={(e) => setSearchText(e.target.value)}
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

      {/* 表格视图 */}
      {viewMode === 'table' && (
        <Table
          rowKey="id"
          size="middle"
          loading={isLoading}
          dataSource={filteredData}
          columns={columns}
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
