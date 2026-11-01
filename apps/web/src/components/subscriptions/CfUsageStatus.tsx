'use client';

import { useState } from 'react';
import { Alert, Button, Descriptions, Empty, Select, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { UsageNode, UsageOverview } from '@/types/usage';

const timestamp = (value: string | number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录';

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
      <Alert showIcon type={data.paused || !data.enabled ? 'warning' : 'info'}
        message={data.paused ? '此节点自动维护已暂停' : data.enabled ? '后台自动维护已开启' : '后台自动维护未开启'}
        description="候选是否进入订阅，仍受订阅自动优选开关、有效期和 CF 网段校验约束。候选失效不会转为直连源站。" />
      <Descriptions size="small" column={1} items={[
        { key: 'regions', label: '地区覆盖', children: regions.length ? <Space wrap>{regions.map(r => <Tag key={r.key} color={missingRegions.includes(r.key) ? 'gold' : 'green'}>{r.label} · {missingRegions.includes(r.key) ? '缺少新鲜候选' : '有新鲜候选'}</Tag>)}</Space> : '尚未登记已标注地区的测点' },
        { key: 'range', label: 'CF 网段最近更新', children: timestamp(data.rangeUpdatedAt) },
        { key: 'schedule', label: '探查节奏', children: data.budget?.lowBudget ? '低预算试点 · 每 8 小时复测两轮' : data.budget?.intervalMinutes ? `每 ${data.budget.intervalMinutes} 分钟（额度、失败退避与任务队列可能延后）` : '按后台任务策略调度' },
        { key: 'budget', label: '全局月度批次保护', children: data.budget?.monthlyLimit != null ? `已用 ${data.budget.used ?? '未知'} / ${data.budget.monthlyLimit} 批 · 剩余 ${data.budget.remaining ?? '未知'} 批（不是云账单硬限额）` : '未设置批次上限' },
      ]} />
      {data.budget?.remaining === 0 && <Alert type="warning" showIcon message="本月全局批次额度已用尽"
        description="新拨测已暂停，等待下个 UTC 月恢复。已有候选仍受有效期限制，不会回退源站。" />}
      {data.budget?.constrained && <Alert type="warning" showIcon message="当前批次额度不足以持续覆盖所有地区"
        description={`仅此节点按当前节奏每 30 天约需 ${data.budget.estimatedMonthlyBatchesPerNode} 批，额度由全部节点共享。达到上限会暂停探查；过期候选降级为通用或被移除，默认 CDN 保留。`} />}
      {(data.registryError || data.rangeError || data.budget?.error) && <Alert type="error" showIcon message="优选维护存在配置异常"
        description={[data.registryError && '测点登记异常', data.rangeError && 'CF 网段同步异常', data.budget?.error && '预算配置异常'].filter(Boolean).join('；')} />}
      {!data.profiles.length && <Empty description="此节点尚无已登记测点。默认 CDN 候选不等于地区实测。" />}
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
