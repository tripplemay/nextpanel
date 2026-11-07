'use client';

import { useState } from 'react';
import { Alert, Button, Descriptions, Empty, Select, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { UsageNode, UsageOverview } from '@/types/usage';

const timestamp = (value: string | number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';
const enrollmentLabels: Record<string, { type: 'info' | 'warning' | 'success' | 'error'; message: string }> = {
  INELIGIBLE: { type: 'warning', message: '此节点尚不符合自动拨测条件' },
  CONFIG_ERROR: { type: 'error', message: '拨测配置异常，暂不能自动纳入' },
  DISABLED: { type: 'warning', message: '全局自动拨测未开启' },
  PAUSED: { type: 'warning', message: '此节点自动维护已暂停' },
  NO_PROBES: { type: 'warning', message: '当前节点未分配可用测点' },
  BUDGET_EXHAUSTED: { type: 'warning', message: '已纳入拨测，本月额度已用尽' },
  WAITING_FIRST_PROBE: { type: 'info', message: '已纳入拨测，等待首次结果' },
  MEASURING: { type: 'info', message: '已开始拨测，等待候选复核' },
  READY: { type: 'success', message: '已纳入拨测，有有效候选' },
  STALE: { type: 'warning', message: '已纳入拨测，候选需要复测' },
  PROBE_ERROR: { type: 'warning', message: '已纳入拨测，最近探查未完成' },
};

export default function CfUsageStatus({ nodes, subscriptions }: { nodes: UsageNode[]; subscriptions: UsageOverview['subscriptions'] }) {
  const [selectedId, setSelectedId] = useState<string>();
  const userId = useAuthStore(s => s.user?.id);
  const eligible = nodes.filter(n => n.eligible);
  const node = eligible.find(n => n.id === selectedId) ?? eligible[0];
  const query = useQuery({ queryKey: ['usage-cf-status', userId, node?.id],
    queryFn: async () => (await subscriptionsApi.cfOptimization(node!.id)).data,
    enabled: !!node, refetchInterval: 30_000, refetchIntervalInBackground: false, retry: 1 });
  if (!node) return <Empty description="暂无受 CDN 保护的兼容节点，请先在订阅管理中启用 CF 自动优选。" />;
  const data = query.data;
  const regions = data?.regions ?? [];
  const missingRegions = data?.missingRegions ?? [];
  const enrollment = data?.enrollment;
  const enrollmentLabel = enrollment && enrollmentLabels[enrollment.state];
  const ineligibleDescription = enrollment?.reason === 'NODE_INACTIVE' ? '节点需启用并处于运行状态。'
    : enrollment?.reason === 'UNSUPPORTED_NODE' ? '节点需使用受托管 CDN 保护的 VLESS + WS / XHTTP + TLS，且回源映射就绪。'
    : '需加入同一所有者已开启 CF 自动优选的订阅，并处于 CDN 保护范围内。';
  return <Space direction="vertical" size={20} style={{ display: 'flex' }}>
    <div><Typography.Title level={5} style={{ marginTop: 0 }}>订阅下发设置</Typography.Title>
      {subscriptions.filter(s => s.protectedCount > 0).map(s => <div key={s.id} style={{ padding: '8px 0' }}><Space wrap>
        <Typography.Text strong>{s.name}</Typography.Text><Tag color={s.automatic ? 'blue' : undefined}>{s.automatic ? '自动优选已开启' : '默认 / 手动 CDN'}</Tag>
        <Typography.Text type="secondary">{s.protectedCount} 个兼容 CF 节点 · 使用观测{s.enabled ? '已开启' : '未开启'}</Typography.Text>
      </Space></div>)}
      <Typography.Text type="secondary">自动优选与使用观测是独立开关。修改下发设置请前往 <a href="/subscriptions">订阅管理</a>。</Typography.Text>
    </div>
    <div><Typography.Title level={5} style={{ marginTop: 0 }}>优选运行状态</Typography.Title>
      <Typography.Paragraph type="secondary">按云测点部署地区维护候选池，自动订阅每地区只取首选 IP，并保留默认 CDN。Clash/Mihomo、Sing-box/HomeProxy 主列表每个托管节点仅一个自动入口，由客户端本地择优。查看本页不触发测速；地区不代表用户所在地、运营商或 CF 实际接入机房。</Typography.Paragraph>
      <Select aria-label="查看优选状态的节点" value={node.id} onChange={setSelectedId} style={{ width: '100%', maxWidth: 420 }} options={eligible.map(n => ({ value: n.id, label: n.name }))} />
    </div>
    {query.isLoading && <Skeleton active paragraph={{ rows: 5 }} />}
    {query.isError && <Alert type="error" showIcon message="优选状态暂时不可用" description="不影响现有代理连接；已保留上次查询结果。" action={<Button onClick={() => query.refetch()}>重试</Button>} />}
    {data && <>
      <Alert showIcon type={enrollmentLabel?.type ?? (data.paused || !data.enabled ? 'warning' : 'info')}
        message={enrollmentLabel?.message ?? (data.paused ? '此节点自动维护已暂停' : data.enabled ? '后台自动维护已开启' : '后台自动维护未开启')}
        description={enrollment && !enrollment.eligible ? ineligibleDescription
          : '纳入队列不等于已有优选 IP；候选通过协议能力校验及连续复核后才进入订阅，失效不会转为直连源站。'} />
      <Descriptions size="small" column={1} items={[
        ...(enrollment ? [{ key: 'enrollment', label: '纳入策略', children: <Space wrap>
          <Tag>{enrollment.mode === 'auto' ? '符合条件自动纳入' : enrollment.mode === 'restricted' ? '限定名单' : '配置异常'}</Tag>
          <Typography.Text>{enrollment.probeCount} 个已分配测点 / {enrollment.availableProbeCount} 个可用测点</Typography.Text>
        </Space> }] : []),
        { key: 'transport', label: '接入传输', children: data.compatibility === 'XHTTP_CAPABLE_CLIENT' || data.compatibility === 'XHTTP_OPT_IN'
          ? <Space wrap><Tag color="cyan">XHTTP + TLS · CDN</Tag><Typography.Text>{data.compatibility === 'XHTTP_CAPABLE_CLIENT'
            ? '支持的客户端自动下发，也可显式指定 XHTTP；兼容入口保留 WS'
            : '此后端仍需显式指定 XHTTP；兼容入口保留 WS'}</Typography.Text></Space>
          : `${data.transport ?? 'WS'} + ${data.tls ?? 'TLS'}` },
        { key: 'regions', label: '地区覆盖', children: regions.length ? <Space wrap>{regions.map(r => <Tag key={r.key} color={missingRegions.includes(r.key) ? 'gold' : 'green'}>{r.label} · {missingRegions.includes(r.key) ? '缺少新鲜候选' : '有新鲜候选'}</Tag>)}</Space>
          : data.profiles.length ? '当前测点尚未标注地区' : enrollment?.availableProbeCount ? '已配置测点，但当前节点未分配地区测点' : '尚无启用的地区测点' },
        { key: 'range', label: 'CF 网段最近更新', children: timestamp(data.rangeUpdatedAt) },
        { key: 'schedule', label: '探查节奏', children: data.budget?.lowBudget ? '低预算试点 · 每 8 小时复测两轮' : data.budget?.intervalMinutes ? `每 ${data.budget.intervalMinutes} 分钟（额度、失败退避与任务队列可能延后）` : '按后台任务策略调度' },
        { key: 'budget', label: '全局月度批次保护', children: data.budget?.monthlyLimit != null ? `已用 ${data.budget.used ?? '未知'} / ${data.budget.monthlyLimit} 批 · 剩余 ${data.budget.remaining ?? '未知'} 批（不是云账单硬限额）` : '未设置批次上限' },
      ]} />
      {data.budget?.remaining === 0 && <Alert type="warning" showIcon message="本月全局批次额度已用尽"
        description="新拨测已暂停，等待下个 UTC 月恢复。已有候选仍受有效期限制，不会回退源站。" />}
      {data.budget?.constrained && <Alert type="warning" showIcon message="当前批次额度不足以持续覆盖所有地区"
        description={`${data.budget.estimatedMonthlyBatchesTotal !== undefined
          ? `按全部 ${data.budget.eligibleNodeCount} 个符合条件节点持续拨测估算，每 30 天约需 ${data.budget.estimatedMonthlyBatchesTotal} 批`
          : `仅此节点按当前节奏每 30 天约需 ${data.budget.estimatedMonthlyBatchesPerNode} 批`}，额度由全部节点共享。系统不会自动提高上限或修改频率；达到上限会暂停探查，默认 CDN 保留。`} />}
      {data.budget?.dailyConstrained && <Alert type="warning" showIcon message="每日候选检测额度可能不足"
        description={`按每批最多 8 个 IP 估算，单测点每天最多需要 ${data.budget.estimatedMaxDailyRequestsPerProbe} 次候选检测，当前上限 ${data.budget.dailyRequestLimitPerProbe} 次。达到上限会延后任务，不会自动提高配额。`} />}
      {(data.registryError || data.rangeError || data.budget?.error) && <Alert type="error" showIcon message="优选维护存在配置异常"
        description={[data.registryError && '测点登记异常', data.rangeError && 'CF 网段同步异常', data.budget?.error && '预算配置异常'].filter(Boolean).join('；')} />}
      {!data.profiles.length && <Empty description="此节点尚未分配可用测点。默认 CDN 候选不等于地区实测。" />}
      {data.profiles.map(profile => <section key={profile.probeId} style={{ borderTop: '1px solid var(--usage-border)', paddingTop: 16 }}>
        <Space wrap><Typography.Text strong>{profile.region} · 云测点</Typography.Text>
          <Tag>{profile.classification === 'REGIONAL' ? '地区探查' : '兼容通用测点'}</Tag>
          <Tag color={profile.error ? 'orange' : profile.stale ? 'gold' : 'blue'}>{profile.error ? '最近探查异常' : profile.stale ? '未测或结果陈旧' : '近期有测点结果'}</Tag>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>{profile.probeId} · {profile.regionKey ?? '未登记地区身份'}<br />最近成功检测：{timestamp(profile.checkedAt)} · 候选版本 {profile.revision}</Typography.Paragraph>
        {profile.error && <Alert type="warning" showIcon message="测点上次检查未完成；已有记录不代表此刻可用。" style={{ marginBottom: 12 }} />}
        <Table size="small" rowKey="ip" pagination={false} dataSource={profile.candidates} locale={{ emptyText: '此测点暂无候选池记录' }} scroll={{ x: 480 }} columns={[
          { title: '候选池（非全部下发）', dataIndex: 'ip', render: (ip: string) => <span style={{ fontFamily: 'monospace' }}>{ip}</span> },
          { title: '测点延迟', dataIndex: 'latency', align: 'right', render: (ms: number) => `${ms} ms` },
          { title: '复查', dataIndex: 'failed', render: (failed: number) => failed ? <Tag color="orange">失败 {failed} 次</Tag> : '无连续失败' },
        ]} />
      </section>)}
      <Typography.Text type="secondary">候选池保留多条备选，不会全部展开为订阅节点。自动订阅每地区最多下发 1 个首选，缺测时保留通用候选，并加入默认 CDN、合并重复 IP。测点结果不承诺所有用户最快；地区或分组变化后需刷新客户端完整订阅。</Typography.Text>
    </>}
  </Space>;
}
