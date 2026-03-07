'use client';

import { Button, Card, Descriptions, Skeleton, Tag, Space, Typography, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { ipCheckApi } from '@/lib/api';
import type { ServerIpCheck } from '@/types/api';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;

interface Props {
  serverId: string;
}

function StatusBadge({ value, region }: { value: string | null; region?: string | null }) {
  if (!value) return <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active />;

  const isPositive = value === 'AVAILABLE' || value === 'UNLOCKED';
  const isPartial = value === 'ORIGINALS_ONLY';

  if (isPositive) {
    const label = region ? `✅ 可用 · ${region}` : '✅ 可用';
    return <Text style={{ color: '#52c41a' }}>{label}</Text>;
  }
  if (isPartial) {
    return <Text style={{ color: '#faad14' }}>⚠️ 仅自制内容</Text>;
  }
  return <Text style={{ color: '#ff4d4f' }}>❌ 不可用</Text>;
}

function NetflixStatus({ netflix, region }: { netflix: string | null; region: string | null }) {
  if (!netflix) return <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active />;

  if (netflix === 'UNLOCKED') {
    const label = region ? `✅ 完全解锁 · ${region}` : '✅ 完全解锁';
    return <Text style={{ color: '#52c41a' }}>{label}</Text>;
  }
  if (netflix === 'ORIGINALS_ONLY') {
    return <Text style={{ color: '#faad14' }}>⚠️ 仅自制内容</Text>;
  }
  return <Text style={{ color: '#ff4d4f' }}>❌ 不可用</Text>;
}

function GfwStatus({ gfwBlocked, gfwCheckedAt }: { gfwBlocked: boolean | null; gfwCheckedAt: string | null }) {
  if (gfwBlocked === null) {
    return <Text type="secondary">未检测</Text>;
  }

  const timeAgo = gfwCheckedAt ? dayjs(gfwCheckedAt).fromNow() : null;
  const status = gfwBlocked
    ? <Text style={{ color: '#ff4d4f' }}>🚫 已被封锁</Text>
    : <Text style={{ color: '#52c41a' }}>✅ 未封锁</Text>;

  return (
    <Space size={8}>
      {status}
      {timeAgo && <Text type="secondary" style={{ fontSize: 12 }}>（{timeAgo}检测）</Text>}
    </Space>
  );
}

function IpTypeTag({ ipType }: { ipType: string | null }) {
  if (!ipType) return <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active />;
  return (
    <Tag color={ipType === 'RESIDENTIAL' ? 'green' : 'orange'}>
      {ipType === 'RESIDENTIAL' ? '原生 IP' : '机房 IP'}
    </Tag>
  );
}

export default function IpCheckCard({ serverId }: Props) {
  const queryClient = useQueryClient();

  const { data: check, isLoading } = useQuery({
    queryKey: ['ip-check', serverId],
    queryFn: () => ipCheckApi.get(serverId).then((r) => r.data),
    refetchInterval: (query) => {
      const data = query.state.data as ServerIpCheck | null;
      if (!data || data.status === 'PENDING' || data.status === 'RUNNING') return 3000;
      return false;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => ipCheckApi.trigger(serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ip-check', serverId] });
    },
  });

  const isChecking = !check || check.status === 'PENDING' || check.status === 'RUNNING';
  const isFailed = check?.status === 'FAILED';
  const hasIpInfo = check && (check.ipType || check.asn);
  const hasStreamingInfo = check && (check.netflix || check.disney || isFailed);

  const cardExtra = (
    <Tooltip title="重新检测全部">
      <Button
        size="small"
        icon={<ReloadOutlined />}
        loading={triggerMutation.isPending || isChecking}
        onClick={() => triggerMutation.mutate()}
      >
        {isChecking ? '检测中...' : '重新检测'}
      </Button>
    </Tooltip>
  );

  if (isLoading) {
    return (
      <Card title="IP 质量检测" size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }} extra={cardExtra}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    );
  }

  return (
    <Card
      title="IP 质量检测"
      size="small"
      style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
      extra={cardExtra}
    >
      <Descriptions column={1} size="small" styles={{ label: { width: 140 } }}>
        {/* IP 基本信息 */}
        <Descriptions.Item label="IP 类型">
          {hasIpInfo ? <IpTypeTag ipType={check.ipType} /> : <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active={isChecking} />}
        </Descriptions.Item>
        <Descriptions.Item label="ASN">
          {hasIpInfo ? (
            <Text>{check.asn ?? '—'}{check.org ? ` · ${check.org}` : ''}</Text>
          ) : (
            <Skeleton.Input size="small" style={{ width: 160, height: 20 }} active={isChecking} />
          )}
        </Descriptions.Item>
        <Descriptions.Item label="归属地">
          {hasIpInfo ? (
            <Text>{check.country ?? '—'}{check.city ? ` · ${check.city}` : ''}</Text>
          ) : (
            <Skeleton.Input size="small" style={{ width: 120, height: 20 }} active={isChecking} />
          )}
        </Descriptions.Item>

        {/* 分隔 */}
        <Descriptions.Item label=" " style={{ paddingBottom: 0 }}><div /></Descriptions.Item>

        {/* 流媒体 */}
        <Descriptions.Item label="Netflix">
          {hasStreamingInfo
            ? <NetflixStatus netflix={check.netflix} region={check.netflixRegion} />
            : <Skeleton.Input size="small" style={{ width: 120, height: 20 }} active={isChecking} />}
        </Descriptions.Item>
        <Descriptions.Item label="Disney+">
          {hasStreamingInfo
            ? <StatusBadge value={check.disney} region={check.disneyRegion} />
            : <Skeleton.Input size="small" style={{ width: 100, height: 20 }} active={isChecking} />}
        </Descriptions.Item>
        <Descriptions.Item label="YouTube Premium">
          {hasStreamingInfo
            ? <StatusBadge value={check.youtube} region={check.youtubeRegion} />
            : <Skeleton.Input size="small" style={{ width: 100, height: 20 }} active={isChecking} />}
        </Descriptions.Item>
        <Descriptions.Item label="Hulu">
          {hasStreamingInfo
            ? <StatusBadge value={check.hulu} />
            : <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active={isChecking} />}
        </Descriptions.Item>
        <Descriptions.Item label="Bilibili 港澳台">
          {hasStreamingInfo
            ? <StatusBadge value={check.bilibili} />
            : <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active={isChecking} />}
        </Descriptions.Item>

        {/* AI 服务 */}
        <Descriptions.Item label=" " style={{ paddingBottom: 0 }}><div /></Descriptions.Item>
        <Descriptions.Item label="OpenAI">
          {hasStreamingInfo
            ? <StatusBadge value={check.openai} />
            : <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active={isChecking} />}
        </Descriptions.Item>
        <Descriptions.Item label="Claude">
          {hasStreamingInfo
            ? <StatusBadge value={check.claude} />
            : <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active={isChecking} />}
        </Descriptions.Item>
        <Descriptions.Item label="Gemini">
          {hasStreamingInfo
            ? <StatusBadge value={check.gemini} />
            : <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active={isChecking} />}
        </Descriptions.Item>

        {/* GFW */}
        <Descriptions.Item label=" " style={{ paddingBottom: 0 }}><div /></Descriptions.Item>
        <Descriptions.Item label="GFW 封锁">
          {check
            ? <GfwStatus gfwBlocked={check.gfwBlocked} gfwCheckedAt={check.gfwCheckedAt} />
            : <Text type="secondary">未配置</Text>}
        </Descriptions.Item>
      </Descriptions>

      {check?.status === 'FAILED' && check.error && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>检测失败: {check.error}</Text>
        </div>
      )}
    </Card>
  );
}
