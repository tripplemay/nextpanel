'use client';

import { Button, Card, Collapse, Descriptions, Skeleton, Tag, Space, Typography, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { ipCheckApi } from '@/lib/api';
import type { ServerIpCheck, RouteData, OutboundNode, InboundNode, RouteHop } from '@/types/api';
import { useIsMobile } from '@/hooks/useIsMobile';

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

const CITIES = ['北京', '上海', '广州'];
const ISPS   = ['联通', '电信', '移动'];

function msText(ms: number) {
  if (ms < 0) return <Text type="secondary">超时</Text>;
  const color = ms < 80 ? '#52c41a' : ms < 150 ? '#faad14' : '#ff4d4f';
  return <Text style={{ color }}>{ms.toFixed(1)} ms</Text>;
}

function RouteInboundTable({ inbound }: { inbound: InboundNode[] }) {
  const map = new Map<string, Map<string, InboundNode>>();
  for (const n of inbound) {
    if (!map.has(n.isp)) map.set(n.isp, new Map());
    map.get(n.isp)!.set(n.city, n);
  }

  const source = inbound[0]?.source;

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '3px 6px', color: '#8c8c8c', fontWeight: 400 }}>运营商</th>
            {CITIES.map((c) => (
              <th key={c} style={{ textAlign: 'center', padding: '3px 6px', color: '#8c8c8c', fontWeight: 400 }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ISPS.map((isp) => (
            <tr key={isp}>
              <td style={{ padding: '3px 6px' }}><Tag style={{ fontSize: 11 }}>{isp}</Tag></td>
              {CITIES.map((city) => {
                const node = map.get(isp)?.get(city);
                return (
                  <td key={city} style={{ textAlign: 'center', padding: '3px 6px' }}>
                    {node ? msText(node.pingMs) : <Text type="secondary">—</Text>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {source && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#bfbfbf' }}>来源: {source}</div>
      )}
    </div>
  );
}

function HopList({ hops }: { hops: RouteHop[] }) {
  return (
    <div style={{ fontSize: 12, lineHeight: '20px', fontFamily: 'monospace' }}>
      {hops.map((h) => {
        const asnOrg = [h.asn, h.org].filter(Boolean).join(' · ');
        return (
          <div key={h.n} style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '1px 0' }}>
            <Text type="secondary" style={{ width: 18, flexShrink: 0, textAlign: 'right', fontSize: 11 }}>
              {h.n}
            </Text>
            <Text style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h.ip === '*' ? <Text type="secondary">*</Text> : h.ip}
            </Text>
            {asnOrg && (
              <Tooltip title={asnOrg}>
                <Text type="secondary" style={{ flexShrink: 0, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                  {asnOrg}
                </Text>
              </Tooltip>
            )}
            <span style={{ flexShrink: 0, width: 54, textAlign: 'right' }}>
              {msText(h.ms)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RouteOutboundList({ outbound }: { outbound: OutboundNode[] }) {
  const items = outbound.map((node) => ({
    key: `${node.isp}-${node.city}`,
    label: (
      <Space size={6}>
        <Tag style={{ fontSize: 11 }}>{node.isp}</Tag>
        <Text style={{ fontSize: 12 }}>{node.city}</Text>
        {msText(node.pingMs)}
        {node.loss > 0 && <Text type="secondary" style={{ fontSize: 11 }}>丢包 {node.loss}/3</Text>}
      </Space>
    ),
    children: node.hops && node.hops.length > 0
      ? <HopList hops={node.hops} />
      : <Text type="secondary" style={{ fontSize: 12 }}>无路由数据</Text>,
  }));

  return <Collapse size="small" ghost items={items} />;
}

const DIVIDER = <div style={{ width: 1, background: '#f0f0f0', alignSelf: 'stretch', margin: '0 16px', flexShrink: 0 }} />;
const SECTION_LABEL: React.CSSProperties = { fontSize: 12, color: '#8c8c8c', display: 'block', marginBottom: 8 };

export default function IpCheckCard({ serverId }: Props) {
  const queryClient = useQueryClient();
  const { isMobile } = useIsMobile();

  const { data: check, isLoading } = useQuery({
    queryKey: ['ip-check', serverId],
    queryFn: () => ipCheckApi.get(serverId).then((r) => r.data),
    refetchInterval: (query) => {
      const data = query.state.data as ServerIpCheck | null;
      if (data && (data.status === 'PENDING' || data.status === 'RUNNING')) return 3000;
      return false;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => ipCheckApi.trigger(serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ip-check', serverId] });
    },
  });

  const neverChecked = !check;
  const isChecking = !!check && (check.status === 'PENDING' || check.status === 'RUNNING');
  const isFailed = check?.status === 'FAILED';
  const hasIpInfo = check && (check.ipType || check.asn);
  const hasStreamingInfo = check && (check.netflix || check.disney || isFailed);
  const routeData: RouteData | null = check?.routeData ?? null;

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
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    );
  }

  if (neverChecked) {
    return (
      <Card title="IP 质量检测" size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Text type="secondary">尚未检测</Text>
          <br />
          <Button
            type="primary"
            style={{ marginTop: 12 }}
            loading={triggerMutation.isPending}
            onClick={() => triggerMutation.mutate()}
          >
            立即检测
          </Button>
        </div>
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
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'flex-start', gap: isMobile ? 16 : 0 }}>

        {/* 左列：流媒体 / AI */}
        <div style={{ flex: 2, minWidth: 0, width: isMobile ? '100%' : undefined }}>
          <Descriptions column={1} size="small" styles={{ label: { width: 130 } }}>
            <Descriptions.Item label="IP 类型">
              {hasIpInfo ? <IpTypeTag ipType={check.ipType} /> : <Skeleton.Input size="small" style={{ width: 80, height: 20 }} active={isChecking} />}
            </Descriptions.Item>
            <Descriptions.Item label="ASN">
              {hasIpInfo
                ? <Text>{check.asn ?? '—'}{check.org ? ` · ${check.org}` : ''}</Text>
                : <Skeleton.Input size="small" style={{ width: 160, height: 20 }} active={isChecking} />}
            </Descriptions.Item>
            <Descriptions.Item label="归属地">
              {hasIpInfo
                ? <Text>{check.country ?? '—'}{check.city ? ` · ${check.city}` : ''}</Text>
                : <Skeleton.Input size="small" style={{ width: 120, height: 20 }} active={isChecking} />}
            </Descriptions.Item>

            <Descriptions.Item label=" " style={{ paddingBottom: 0 }}><div /></Descriptions.Item>

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

            <Descriptions.Item label=" " style={{ paddingBottom: 0 }}><div /></Descriptions.Item>

            <Descriptions.Item label="GFW 封锁">
              {check
                ? <GfwStatus gfwBlocked={check.gfwBlocked} gfwCheckedAt={check.gfwCheckedAt} />
                : <Text type="secondary">未配置</Text>}
            </Descriptions.Item>
          </Descriptions>

          {isFailed && check.error && (
            <Text type="secondary" style={{ fontSize: 12 }}>检测失败: {check.error}</Text>
          )}
        </div>

        {!isMobile && DIVIDER}

        {/* 右列：路由测试，内部再拆两列（移动端垂直排列） */}
        <div style={{ flex: 3, minWidth: 0, width: isMobile ? '100%' : undefined, display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'flex-start', gap: isMobile ? 16 : 0 }}>

          {/* 去程 */}
          <div style={{ flex: 1, minWidth: 0, width: isMobile ? '100%' : undefined }}>
            <Text style={SECTION_LABEL}>去程（中国 → 节点）</Text>
            {isChecking ? (
              <Skeleton active paragraph={{ rows: 4 }} />
            ) : routeData?.inbound && routeData.inbound.length > 0 ? (
              <RouteInboundTable inbound={routeData.inbound} />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>去程数据暂不支持</Text>
            )}
          </div>

          {!isMobile && DIVIDER}

          {/* 回程 */}
          <div style={{ flex: 1, minWidth: 0, width: isMobile ? '100%' : undefined }}>
            <Text style={SECTION_LABEL}>回程（节点 → 中国）</Text>
            {isChecking ? (
              <Skeleton active paragraph={{ rows: 5 }} />
            ) : routeData?.outbound && routeData.outbound.length > 0 ? (
              <>
                <RouteOutboundList outbound={routeData.outbound} />
                <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
                  检测时间: {dayjs(routeData.checkedAt).format('MM-DD HH:mm')}
                </Text>
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {routeData ? '回程数据为空' : '暂无路由数据，点击「重新检测」获取'}
              </Text>
            )}
          </div>

        </div>
      </div>
    </Card>
  );
}
