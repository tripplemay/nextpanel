'use client';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Card, Space, Tag, Typography, Progress, Dropdown, Button, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import StatusTag from '@/components/common/StatusTag';
import type { Server } from '@/types/api';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;

function heartbeatColor(lastSeenAt: string | null): string {
  if (!lastSeenAt) return '#8c8c8c';
  const diffMin = dayjs().diff(dayjs(lastSeenAt), 'minute');
  if (diffMin <= 5) return '#52c41a';
  if (diffMin <= 30) return '#faad14';
  return '#ff4d4f';
}

function pingColor(ms: number | null): string {
  if (ms == null) return '#8c8c8c';
  if (ms <= 50) return '#52c41a';
  if (ms <= 150) return '#faad14';
  return '#ff4d4f';
}

function usageColor(pct: number | null | undefined): string {
  if (pct == null) return '#1677ff';
  if (pct < 70) return '#52c41a';
  if (pct < 90) return '#faad14';
  return '#ff4d4f';
}

interface Props {
  server: Server;
  testingSsh: boolean;
  onEdit: (server: Server) => void;
  onInstall: (server: Server) => void;
  onDelete: (server: Server) => void;
  onTestSsh: (server: Server) => void;
}

export default function ServerCard({
  server,
  testingSsh,
  onEdit,
  onInstall,
  onDelete,
  onTestSsh,
}: Props) {
  return (
    <Card
      size="small"
      style={{ borderRadius: 8 }}
      styles={{ body: { padding: 16 } }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <Space size={4}>
            <Text strong style={{ fontSize: 14 }} ellipsis>{server.name}</Text>
            {server.notes && (
              <Tooltip title={server.notes}>
                <FileTextOutlined style={{ color: '#8c8c8c', fontSize: 11 }} />
              </Tooltip>
            )}
          </Space>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>{server.ip}</Text>
          </div>
        </div>
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'edit',
                icon: <EditOutlined />,
                label: '编辑',
                onClick: () => onEdit(server),
              },
              {
                key: 'ssh',
                icon: <CheckCircleOutlined />,
                label: testingSsh ? '测试中...' : '测试 SSH',
                disabled: testingSsh,
                onClick: () => onTestSsh(server),
              },
              {
                key: 'install',
                icon: <CloudDownloadOutlined />,
                label: '安装 / 更新 Agent',
                onClick: () => onInstall(server),
              },
              { type: 'divider' },
              {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: '删除',
                danger: true,
                onClick: () => onDelete(server),
              },
            ],
          }}
        >
          <Button size="small" type="text" icon={<MoreOutlined />} />
        </Dropdown>
      </div>

      {/* 状态 + 延迟 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <StatusTag status={server.status} />
        <Space size={8}>
          {server.pingMs != null && (
            <Text style={{ fontSize: 12, color: pingColor(server.pingMs) }}>
              {server.pingMs} ms
            </Text>
          )}
          <Text style={{ fontSize: 11, color: heartbeatColor(server.lastSeenAt) }}>
            {server.lastSeenAt ? dayjs(server.lastSeenAt).fromNow() : '从未连接'}
          </Text>
        </Space>
      </div>

      {/* 资源进度条 */}
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {(['cpuUsage', 'memUsage', 'diskUsage'] as const).map((key) => {
          const labels: Record<string, string> = { cpuUsage: 'CPU', memUsage: '内存', diskUsage: '磁盘' };
          const val = server[key];
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 11, color: '#8c8c8c', width: 28, flexShrink: 0 }}>{labels[key]}</Text>
              <Progress
                percent={val != null ? Math.round(val) : 0}
                size="small"
                strokeColor={usageColor(val)}
                style={{ flex: 1, margin: 0 }}
                format={(p) => val != null ? `${p}%` : '—'}
              />
            </div>
          );
        })}
      </Space>

      {/* 标签 */}
      {server.tags.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {server.tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}
        </div>
      )}
    </Card>
  );
}
