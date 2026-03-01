'use client';

import { useState } from 'react';
import { App, Table, Tag, Card, Typography, Select, Space, Spin, Empty } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { auditApi, operationLogsApi } from '@/lib/api';
import type { AuditLog, OperationLogDetail } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

const { Title, Text } = Typography;

// Actions that may have associated SSH terminal logs
const SSH_LOG_ACTIONS = new Set(['CREATE', 'UPDATE', 'DELETE', 'DEPLOY']);

const ACTION_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'CREATE', label: 'CREATE' },
  { value: 'UPDATE', label: 'UPDATE' },
  { value: 'DELETE', label: 'DELETE' },
  { value: 'LOGIN', label: 'LOGIN' },
  { value: 'LOGOUT', label: 'LOGOUT' },
  { value: 'DEPLOY', label: 'DEPLOY' },
  { value: 'ROLLBACK', label: 'ROLLBACK' },
  { value: 'SSH_TEST', label: 'SSH_TEST' },
];

const ACTION_COLOR: Record<string, string> = {
  CREATE: 'green',
  UPDATE: 'blue',
  DELETE: 'red',
  LOGIN: 'cyan',
  LOGOUT: 'default',
  DEPLOY: 'purple',
  ROLLBACK: 'orange',
  SSH_TEST: 'geekblue',
};

// ── SSH log pane (lazy-loaded) ────────────────────────────────────────────────

function SshLogPane({ correlationId }: { correlationId: string }) {
  const { data, isLoading } = useQuery<OperationLogDetail | null>({
    queryKey: ['operation-log-correlation', correlationId],
    queryFn: () => operationLogsApi.getByCorrelationId(correlationId).then((r) => r.data),
    staleTime: 60_000,
  });

  if (isLoading) return <Spin size="small" style={{ margin: '8px 0' }} />;
  if (!data?.log) {
    return <Text type="secondary" style={{ fontSize: 12 }}>暂无 SSH 日志</Text>;
  }

  const lines = data.log.split('\n');
  return (
    <div
      style={{
        background: '#0d1117',
        color: '#c9d1d9',
        fontFamily: 'monospace',
        fontSize: 12,
        padding: 12,
        borderRadius: 4,
        maxHeight: 360,
        overflowY: 'auto',
        lineHeight: 1.7,
      }}
    >
      {lines.map((line, i) => {
        const isError = line.includes('error') || line.includes('Error') || line.includes('失败');
        const isSuccess =
          line.includes('成功') ||
          line.includes('completed') ||
          line.includes('OK') ||
          line.includes('已停止') ||
          line.includes('已删除');
        return (
          <div key={i} style={{ color: isError ? '#f85149' : isSuccess ? '#3fb950' : '#c9d1d9' }}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

// ── Expanded row content ──────────────────────────────────────────────────────

function ExpandedRowContent({ record }: { record: AuditLog }) {
  const hasDiff =
    record.diff !== null &&
    record.diff !== undefined &&
    typeof record.diff === 'object' &&
    Object.keys(record.diff as object).length > 0;

  const hasSshLog =
    record.resource === 'node' &&
    SSH_LOG_ACTIONS.has(record.action) &&
    !!record.correlationId;

  if (!hasDiff && !hasSshLog) {
    return <Empty description="暂无详情" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '8px 0' }} />;
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {hasDiff && (
        <div>
          <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
            变更详情
          </Text>
          <pre
            style={{
              background: '#f6f8fa',
              border: '1px solid #e8e8e8',
              borderRadius: 4,
              padding: 10,
              fontSize: 12,
              maxHeight: 240,
              overflowY: 'auto',
              margin: 0,
            }}
          >
            {JSON.stringify(record.diff, null, 2)}
          </pre>
        </div>
      )}
      {hasSshLog && (
        <div>
          <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
            SSH 执行日志
          </Text>
          <SshLogPane correlationId={record.correlationId!} />
        </div>
      )}
    </Space>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', page, actionFilter],
    queryFn: () =>
      auditApi
        .list(page, pageSize, actionFilter || undefined)
        .then((r) => r.data),
  });

  if (isError) message.error('加载审计日志失败');

  const columns: ColumnType<AuditLog>[] = [
    {
      title: '操作人',
      width: 120,
      render: (_: unknown, r: AuditLog) => r.actor?.username ?? '—',
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 110,
      render: (a: string) => (
        <Tag color={ACTION_COLOR[a] ?? 'default'} style={{ fontFamily: 'monospace' }}>
          {a}
        </Tag>
      ),
    },
    { title: '资源类型', dataIndex: 'resource', width: 110 },
    {
      title: '资源 ID',
      dataIndex: 'resourceId',
      width: 120,
      render: (v: string | null) =>
        v ? <Text code style={{ fontSize: 11 }}>{v.slice(0, 8)}</Text> : '—',
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 140,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '时间',
      dataIndex: 'timestamp',
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  // Only rows with diff or SSH log should be expandable
  const rowExpandable = (record: AuditLog) => {
    const hasDiff =
      record.diff !== null &&
      record.diff !== undefined &&
      typeof record.diff === 'object' &&
      Object.keys(record.diff as object).length > 0;
    const hasSshLog =
      record.resource === 'node' &&
      SSH_LOG_ACTIONS.has(record.action) &&
      !!record.correlationId;
    return hasDiff || hasSshLog;
  };

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <Space style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>审计日志</Title>
        <Select
          style={{ width: 160 }}
          placeholder="筛选动作类型"
          value={actionFilter}
          onChange={(v) => {
            setActionFilter(v);
            setPage(1);
          }}
          options={ACTION_OPTIONS}
        />
      </Space>
      <Table<AuditLog>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.data}
        columns={columns}
        expandable={{
          expandedRowRender: (record) => <ExpandedRowContent record={record} />,
          rowExpandable,
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total,
          onChange: (p) => {
            setPage(p);
          },
          showTotal: (total) => `共 ${total} 条`,
        }}
        size="middle"
      />
    </Card>
  );
}
