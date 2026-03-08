'use client';

import { use, useState, useEffect } from 'react';
import { Grid } from 'antd';
import { useRouter } from 'next/navigation';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import {
  Card,
  Row,
  Col,
  Button,
  Descriptions,
  Tag,
  Table,
  Typography,
  Space,
  Spin,
  Empty,
  Badge,
  Statistic,
  Tooltip as AntTooltip,
} from 'antd';
import { ArrowLeftOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { serversApi, metricsApi, nodesApi, operationLogsApi } from '@/lib/api';
import StatusTag from '@/components/common/StatusTag';
import IpCheckCard from '@/components/servers/IpCheckCard';
import type { Node, Metric, OperationLogEntry } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text } = Typography;

function GfwDot({ gfwBlocked }: { gfwBlocked: boolean | null | undefined }) {
  const color = gfwBlocked === false ? '#52c41a' : gfwBlocked === true ? '#ff4d4f' : '#d9d9d9';
  const label = gfwBlocked === false ? '未被封锁' : gfwBlocked === true ? '已被封锁' : 'GFW 未检测';
  return (
    <AntTooltip title={label}>
      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
    </AntTooltip>
  );
}

const CHART_WINDOW = 60;

function formatRate(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function usageColor(pct: number | null | undefined): string {
  if (pct == null) return '#1677ff';
  if (pct < 70) return '#52c41a';
  if (pct < 90) return '#faad14';
  return '#ff4d4f';
}

export default function ServerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const { data: server, isLoading: serverLoading } = useQuery({
    queryKey: ['server', id],
    queryFn: () => serversApi.get(id).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const { data: latestMetrics = [] } = useQuery({
    queryKey: ['metrics', id],
    queryFn: () => metricsApi.server(id, 60).then((r) => r.data as Metric[]),
    refetchInterval: 30_000,
    enabled: !!id,
  });

  const { data: nodes = [] } = useQuery({
    queryKey: ['nodes', id],
    queryFn: () => nodesApi.list(id).then((r) => r.data as Node[]),
    refetchInterval: 30_000,
    enabled: !!id,
  });

  const { data: logs = [] } = useQuery({
    queryKey: ['operation-logs', 'server', id],
    queryFn: () => operationLogsApi.listByResource('server', id).then((r) => r.data),
    enabled: !!id,
  });

  // 滑窗：追加新数据点，保留最近 CHART_WINDOW 条，按时间升序
  const [accMetrics, setAccMetrics] = useState<Metric[]>([]);
  useEffect(() => {
    if (latestMetrics.length === 0) return;
    setAccMetrics((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const newPoints = latestMetrics.filter((m) => !existingIds.has(m.id));
      if (newPoints.length === 0) return prev;
      const combined = [...prev, ...newPoints];
      combined.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      return combined.slice(-CHART_WINDOW);
    });
  }, [latestMetrics]);

  // 图表数据（已是升序）
  const chartData = accMetrics.map((m) => ({
    time: dayjs(m.timestamp).format('HH:mm'),
    CPU: parseFloat(m.cpu.toFixed(1)),
    内存: parseFloat(m.mem.toFixed(1)),
    磁盘: parseFloat(m.disk.toFixed(1)),
    上传: parseFloat((m.networkOut / 1024).toFixed(1)),
    下载: parseFloat((m.networkIn / 1024).toFixed(1)),
  }));

  const timeRange =
    chartData.length >= 2
      ? `${chartData[0].time} – ${chartData[chartData.length - 1].time}`
      : null;

  const nodeColumns: ColumnType<Node>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '协议', dataIndex: 'protocol' },
    { title: '实现', dataIndex: 'implementation', render: (v) => v ?? '—' },
    { title: '端口', dataIndex: 'listenPort' },
    {
      title: '来源',
      dataIndex: 'source',
      render: (v: string) => (
        <Tag color={v === 'AUTO' ? 'blue' : 'default'}>{v === 'AUTO' ? '自动' : '手动'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v: string) => <StatusTag status={v} />,
    },
    {
      title: '上传',
      dataIndex: 'trafficUpBytes',
      render: (v: number) => formatBytes(v),
    },
    {
      title: '下载',
      dataIndex: 'trafficDownBytes',
      render: (v: number) => formatBytes(v),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
  ];

  const logColumns: ColumnType<OperationLogEntry>[] = [
    { title: '操作', dataIndex: 'operation', width: 120 },
    {
      title: '结果',
      dataIndex: 'success',
      width: 80,
      render: (v: boolean) => (
        <Badge status={v ? 'success' : 'error'} text={v ? '成功' : '失败'} />
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 80,
      render: (v: number | null) => (v != null ? `${v} ms` : '—'),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
  ];

  if (serverLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!server) return <Empty description="服务器不存在" />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 页头 */}
      <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/servers')}>
              {!isMobile && '返回'}
            </Button>
            <div>
              <Title level={4} style={{ margin: 0 }}>{server.name}</Title>
              <Space size={6}>
                <Text type="secondary" style={{ fontSize: 12 }}>{server.ip}</Text>
                <GfwDot gfwBlocked={server.ipCheck?.gfwBlocked} />
              </Space>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingLeft: isMobile ? 0 : 4 }}>
          <StatusTag status={server.status} />
          {server.pingMs != null && (
            <Text style={{ color: server.pingMs <= 50 ? '#52c41a' : server.pingMs <= 150 ? '#faad14' : '#ff4d4f' }}>
              {server.pingMs} ms
            </Text>
          )}
          {server.agentVersion && (
            <Tag color="blue">Agent {server.agentVersion}</Tag>
          )}
          {server.lastSeenAt && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              最后心跳 {dayjs(server.lastSeenAt).fromNow()}
            </Text>
          )}
          </div>
        </div>
      </Card>

      {/* 基础信息 */}
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card title="基础信息" size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="IP 地址">{server.ip}</Descriptions.Item>
              <Descriptions.Item label="区域">{server.region || '—'}</Descriptions.Item>
              <Descriptions.Item label="提供商">{server.provider || '—'}</Descriptions.Item>
              <Descriptions.Item label="标签">
                {server.tags.length > 0
                  ? server.tags.map((t) => <Tag key={t}>{t}</Tag>)
                  : '—'}
              </Descriptions.Item>
              {server.notes && (
                <Descriptions.Item label="备注">{server.notes}</Descriptions.Item>
              )}
              <Descriptions.Item label="创建时间">
                {dayjs(server.createdAt).format('YYYY-MM-DD HH:mm')}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="SSH 配置" size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="SSH 端口">{server.sshPort}</Descriptions.Item>
              <Descriptions.Item label="SSH 用户">{server.sshUser}</Descriptions.Item>
              <Descriptions.Item label="认证方式">
                <Tag>{server.sshAuthType === 'KEY' ? '私钥' : '密码'}</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* 当前资源数值 */}
      <Row gutter={16}>
        {(
          [
            { label: 'CPU', value: server.cpuUsage },
            { label: '内存', value: server.memUsage },
            { label: '磁盘', value: server.diskUsage },
          ] as { label: string; value: number | null }[]
        ).map(({ label, value }) => (
          <Col xs={12} sm={6} key={label}>
            <Card size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', textAlign: 'center' }}>
              <Statistic
                title={label}
                value={value != null ? Math.round(value) : '—'}
                suffix={value != null ? '%' : undefined}
                valueStyle={{ color: usageColor(value), fontSize: 24 }}
              />
            </Card>
          </Col>
        ))}
        <Col xs={12} sm={6}>
          <Card size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>网速</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#52c41a', lineHeight: 1.3 }}>
              <ArrowUpOutlined style={{ fontSize: 14, marginRight: 4 }} />
              {server.networkOut != null ? formatRate(server.networkOut) : '—'}
            </div>
            <div style={{ fontSize: 14, color: '#1677ff', marginTop: 2 }}>
              <ArrowDownOutlined style={{ fontSize: 12, marginRight: 4 }} />
              {server.networkIn != null ? formatRate(server.networkIn) : '—'}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 资源趋势图 */}
      <Card
        title={`资源使用趋势${timeRange ? `（${timeRange}）` : ''}`}
        size="small"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
      >
        {chartData.length === 0 ? (
          <Empty description="暂无监控数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Row gutter={16}>
            <Col xs={24} xl={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>CPU / 内存 / 磁盘 (%)</Text>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => (v != null ? `${v}%` : '')} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="CPU" stroke="#1677ff" dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="内存" stroke="#52c41a" dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="磁盘" stroke="#faad14" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </Col>
            <Col xs={24} xl={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                网络流量 (KB/s){timeRange ? `　${timeRange}` : ''}
              </Text>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} unit=" KB/s" />
                  <Tooltip formatter={(v) => (v != null ? formatRate(Number(v) * 1024) : '')} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="上传" stroke="#52c41a" dot={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="下载" stroke="#1677ff" dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </Col>
          </Row>
        )}
      </Card>

      {/* IP 质量检测 */}
      <IpCheckCard serverId={id} />

      {/* 节点列表 */}
      <Card
        title={`节点列表（${nodes.length}）`}
        size="small"
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
        extra={<Button size="small" onClick={() => router.push('/nodes')}>前往节点管理</Button>}
      >
        <Table
          rowKey="id"
          size="middle"
          dataSource={nodes}
          columns={nodeColumns}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>

      {/* 操作日志 */}
      <Card title={`操作日志（${logs.length}）`} size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table
          rowKey="id"
          size="middle"
          dataSource={logs}
          columns={logColumns}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>
    </Space>
  );
}
