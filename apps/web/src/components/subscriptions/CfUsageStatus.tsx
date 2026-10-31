'use client';

import { useState } from 'react';
import { Alert, Button, Descriptions, Empty, Select, Skeleton, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { subscriptionsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { UsageNode, UsageOverview } from '@/types/usage';

const names: Record<string, string> = { TELECOM: '电信', UNICOM: '联通', MOBILE: '移动', GENERIC: '通用测点' };
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
  return <Space direction="vertical" size={20} style={{ display: 'flex' }}>
    <div><Typography.Title level={5} style={{ marginTop: 0 }}>订阅下发设置</Typography.Title>
      {subscriptions.filter(s => s.protectedCount > 0).map(s => <div key={s.id} style={{ padding: '8px 0' }}><Space wrap>
        <Typography.Text strong>{s.name}</Typography.Text><Tag color={s.automatic ? 'blue' : undefined}>{s.automatic ? '自动优选已开启' : '默认 / 手动 CDN'}</Tag>
        <Typography.Text type="secondary">{s.protectedCount} 个兼容 CF 节点 · 使用观测{s.enabled ? '已开启' : '未开启'}</Typography.Text>
      </Space></div>)}
      <Typography.Text type="secondary">自动优选与使用观测是独立开关。修改下发设置请前往 <a href="/subscriptions">订阅管理</a>。</Typography.Text>
    </div>
    <div><Typography.Title level={5} style={{ marginTop: 0 }}>优选运行状态</Typography.Title>
      <Typography.Paragraph type="secondary">查看后台探查与候选维护，不触发新测速。测点结果不代表客户端速度，也不代表客户端已更新订阅。</Typography.Paragraph>
      <Select aria-label="查看优选状态的节点" value={node.id} onChange={setSelectedId} style={{ width: '100%', maxWidth: 420 }} options={eligible.map(n => ({ value: n.id, label: n.name }))} />
    </div>
    {query.isLoading && <Skeleton active paragraph={{ rows: 5 }} />}
    {query.isError && <Alert type="error" showIcon message="优选状态暂时不可用" description="不影响现有代理连接；已保留上次查询结果。" action={<Button onClick={() => query.refetch()}>重试</Button>} />}
    {data && <>
      <Alert showIcon type={data.paused || !data.enabled ? 'warning' : 'info'}
        message={data.paused ? '此节点自动维护已暂停' : data.enabled ? '后台自动维护已开启' : '后台自动维护未开启'}
        description="候选是否进入订阅，仍受订阅自动优选开关、有效期和 CF 网段校验约束。候选失效不会转为直连源站。" />
      <Descriptions size="small" column={1} items={[
        { key: 'carriers', label: '缺少有效运营商实测', children: data.missingCarriers.map(c => names[c] ?? c).join('、') || '无' },
        { key: 'range', label: 'CF 网段最近更新', children: timestamp(data.rangeUpdatedAt) },
        { key: 'schedule', label: '探查节奏', children: data.budget?.lowBudget ? '低预算试点 · 每 8 小时复测两轮' : '按后台任务策略调度' },
        { key: 'budget', label: '全局月度批次保护', children: data.budget?.monthlyLimit != null ? `最多 ${data.budget.monthlyLimit} 批（不是云账单硬限额）` : '未设置批次上限' },
      ]} />
      {(data.registryError || data.rangeError || data.budget?.error) && <Alert type="error" showIcon message="优选维护存在配置异常"
        description={[data.registryError && '测点登记异常', data.rangeError && 'CF 网段同步异常', data.budget?.error && '预算配置异常'].filter(Boolean).join('；')} />}
      {!data.profiles.length && <Empty description="尚无已登记测点。默认 CDN 候选不等于运营商实测。" />}
      {data.profiles.map(profile => <section key={profile.probeId} style={{ borderTop: '1px solid var(--usage-border)', paddingTop: 16 }}>
        <Space wrap><Typography.Text strong>{names[profile.carrier] ?? profile.carrier} · {profile.region}</Typography.Text>
          <Tag color={profile.error ? 'orange' : profile.stale ? 'gold' : 'blue'}>{profile.error ? '最近探查异常' : profile.stale ? '未测或结果陈旧' : '近期有测点结果'}</Tag>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>最近成功检测：{timestamp(profile.checkedAt)} · 候选版本 {profile.revision}</Typography.Paragraph>
        {profile.error && <Alert type="warning" showIcon message="测点上次检查未完成；已有记录不代表此刻可用。" style={{ marginBottom: 12 }} />}
        <Table size="small" rowKey="ip" pagination={false} dataSource={profile.candidates} locale={{ emptyText: '此测点暂无已发布记录' }} scroll={{ x: 480 }} columns={[
          { title: '已发布候选记录', dataIndex: 'ip', render: (ip: string) => <span style={{ fontFamily: 'monospace' }}>{ip}</span> },
          { title: '测点延迟', dataIndex: 'latency', align: 'right', render: (ms: number) => `${ms} ms` },
          { title: '复查', dataIndex: 'failed', render: (failed: number) => failed ? <Tag color="orange">失败 {failed} 次</Tag> : '无连续失败' },
        ]} />
      </section>)}
      <Typography.Text type="secondary">运营商名称表示测点档案，不是当前用户的真实运营商。通用云测点不能代表中国大陆三网用户体验；已发布记录不等于当前有效下发清单。</Typography.Text>
    </>}
  </Space>;
}
