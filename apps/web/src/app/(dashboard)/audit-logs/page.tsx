'use client';

import { useState } from 'react';
import { Table, Tag, Card, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import type { ColumnType } from 'antd/es/table';

const { Title } = Typography;

interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  ip: string | null;
  timestamp: string;
  actor: { username: string };
}

const actionColor: Record<string, string> = {
  CREATE: 'green',
  UPDATE: 'blue',
  DELETE: 'red',
  LOGIN: 'cyan',
  LOGOUT: 'default',
  DEPLOY: 'purple',
  ROLLBACK: 'orange',
  SSH_TEST: 'geekblue',
};

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => auditApi.list(page, pageSize).then((r) => r.data as { data: AuditLog[]; total: number }),
  });

  const columns: ColumnType<AuditLog>[] = [
    { title: '操作人', render: (_: unknown, r) => r.actor?.username },
    {
      title: '动作',
      dataIndex: 'action',
      render: (a: string) => <Tag color={actionColor[a]}>{a}</Tag>,
    },
    { title: '资源类型', dataIndex: 'resource' },
    { title: '资源 ID', dataIndex: 'resourceId', render: (v: string | null) => v?.slice(0, 8) ?? '—' },
    { title: 'IP', dataIndex: 'ip', render: (v: string | null) => v ?? '—' },
    { title: '时间', dataIndex: 'timestamp', render: (v: string) => new Date(v).toLocaleString() },
  ];

  return (
    <Card>
      <Title level={4} style={{ marginBottom: 16 }}>审计日志</Title>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.data}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total: data?.total,
          onChange: setPage,
        }}
      />
    </Card>
  );
}
