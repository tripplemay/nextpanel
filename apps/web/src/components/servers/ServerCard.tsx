'use client';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Card, Space, Tag, Typography, Progress, Dropdown, Button, Tooltip } from 'antd';
import ServerTagList from './ServerTagList';

function GfwDot({ gfwBlocked }: { gfwBlocked: boolean | null | undefined }) {
  const color = gfwBlocked === false ? '#52c41a' : gfwBlocked === true ? '#ff4d4f' : '#d9d9d9';
  const label = gfwBlocked === false ? '未被封锁' : gfwBlocked === true ? '已被封锁' : 'GFW 未检测';
  return (
    <Tooltip title={label}>
      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
    </Tooltip>
  );
}
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
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
  onForceDelete: (server: Server) => void;
  onTestSsh: (server: Server) => void;
}

export default function ServerCard({
  server,
  testingSsh,
  onEdit,
  onInstall,
  onDelete,
  onForceDelete,
  onTestSsh,
}: Props) {
  const router = useRouter();
  const isDeleting = server.status === 'DELETING';
  const hasDeleteError = server.status === 'ERROR' && !!server.deleteError;

  return (
    <Card
      size="small"
      style={{ borderRadius: 8, opacity: isDeleting ? 0.6 : 1, cursor: 'pointer' }}
      styles={{ body: { padding: 16 } }}
      onClick={() => router.push(`/servers/${server.id}`)}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <Space size={4}>
            {server.countryCode && (
              <span
                className={`fi fi-${server.countryCode.toLowerCase()} fis`}
                style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0 }}
              />
            )}
            <Text strong style={{ fontSize: 14 }} ellipsis>{server.name}</Text>
            {server.notes && (
              <Tooltip title={server.notes}>
                <FileTextOutlined style={{ color: '#8c8c8c', fontSize: 11 }} />
              </Tooltip>
            )}
          </Space>
          <Space size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>{server.ip}</Text>
            <GfwDot gfwBlocked={server.ipCheck?.gfwBlocked} />
          </Space>
          {(server.region || server.provider) && (
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {[server.region, server.provider].filter(Boolean).join(' · ')}
              </Text>
            </div>
          )}
        </div>
        {!isDeleting && !hasDeleteError && (
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
            <Button size="small" type="text" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} />
          </Dropdown>
        )}
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
      {(server.tags.length > 0 || (server.autoTags ?? []).length > 0) && (
        <div style={{ marginTop: 10 }}>
          <ServerTagList tags={server.tags} autoTags={server.autoTags ?? []} readonly />
        </div>
      )}

      {/* 删除失败操作区 */}
      {hasDeleteError && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0' }}>
          <Text type="danger" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
            节点清理失败，请重试或强制删除
          </Text>
          <Space size={6}>
            <Button size="small" danger onClick={() => onDelete(server)}>重试删除</Button>
            <Button size="small" onClick={() => onForceDelete(server)}>强制删除</Button>
          </Space>
        </div>
      )}
    </Card>
  );
}
