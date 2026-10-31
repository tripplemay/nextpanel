'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { Alert, App, Button, Descriptions, Drawer, Empty, Input, Result, Select, Skeleton, Space, Steps, Switch, Table, Tabs, Tag, Tooltip, Typography, theme } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CheckCircleOutlined, ClockCircleOutlined, CloudServerOutlined, InfoCircleOutlined, ReloadOutlined, SafetyCertificateOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi, usageApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useIsMobile } from '@/hooks/useIsMobile';
import PageHeader from '@/components/common/PageHeader';
import type { UsageStatus } from '@/types/usage';
import styles from './usage.module.css';

const UsageHistory = dynamic(() => import('@/components/subscriptions/UsageHistory'), { loading: () => <Skeleton active /> });
const CfUsageStatus = dynamic(() => import('@/components/subscriptions/CfUsageStatus'), { loading: () => <Skeleton active /> });
const statuses: Record<UsageStatus, { label: string; color?: string; hint: string }> = {
  ACTIVE: { label: '近期有流量', color: 'green', hint: '近 60 秒观测到流量增长，可能包含客户端自动健康检查。' },
  IDLE: { label: '暂无近期流量', hint: '采样正常，但近期没有流量增长；不等于用户离线或节点故障。' },
  STALE: { label: '数据待更新', color: 'gold', hint: '缺少新鲜采样。请检查服务器 Agent 版本与状态。' },
  PENDING: { label: '凭据待同步', color: 'blue', hint: '新凭据尚未验证可用；订阅继续使用原有 CDN 凭据。' },
  PAUSED: { label: '观测已暂停', hint: '不再发布新观测凭据；已导入的代理配置继续可用。' },
  REVOKING: { label: '撤销待确认', color: 'orange', hint: '授权已失效，等待服务器确认移除认证身份。' },
};
const carrierNames: Record<string, string> = { TELECOM: '电信', UNICOM: '联通', MOBILE: '移动', GENERIC: '通用', DNS: '默认 CDN', MANUAL: '手动候选' };
const errors: Record<string, string> = {
  PREPARATION_REQUIRED: '需要先准备节点统计能力', SYNC_FAILED: '同步未完成，请检查 SSH 和节点状态',
  CREDENTIAL_LIMIT: '候选身份达到保护上限，新候选继续使用原凭据', UNSUPPORTED_API: '当前 Xray 不支持所需用户管理接口',
  CONFIG_DRIFT: '远端配置已变化，已停止自动修改', ROLLBACK_FAILED: '回退未验证，请先检查节点服务',
  CONFIG_VALIDATION_FAILED: '配置校验失败，未应用新配置', REVOCATION_PENDING: '凭据撤销尚未确认',
  CONFIG_ACTIVATION_FAILED: '配置切换未完成，请检查文件权限和磁盘空间', RESTART_FAILED: '首次启动验证失败，已执行配置回退',
  VERIFICATION_FAILED: '运行凭据验证未通过，新身份仍不下发', RUNTIME_IDENTITY_CONFLICT: '远端身份与面板不一致，已停止自动修改',
  UNSUPPORTED_CONFIG: '节点配置不兼容，请检查 Xray 和统计入口', INVALID_CONFIG: '配置格式无法安全识别',
  RESERVED_LEVEL_CONFLICT: '统计策略编号与现有配置冲突，未自动覆盖', INVALID_RUNTIME_USERS: '无法确认运行中的认证身份',
};
function time(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录'; }
function rate(value: number | null) {
  if (value === null) return '—';
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB/s`;
  return `${(value / 1024).toFixed(1)} KB/s`;
}
function State({ value }: { value: UsageStatus }) { const s = statuses[value]; return <Tooltip title={s.hint}><Tag color={s.color} icon={value === 'ACTIVE' ? <CheckCircleOutlined /> : <ClockCircleOutlined />}>{s.label}</Tag></Tooltip>; }

export default function UsagePage() {
  const { token } = theme.useToken();
  const { modal, message } = App.useApp();
  const { isMobile } = useIsMobile();
  const user = useAuthStore(s => s.user);
  const allowed = !!user && user.role !== 'VIEWER';
  const cache = useQueryClient();
  const [subscription, setSubscription] = useState<string>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UsageStatus>();
  const [tab, setTab] = useState('activity');
  const [selectedId, setSelectedId] = useState<string>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const query = useQuery({ queryKey: ['usage', user?.id], queryFn: async () => (await usageApi.overview()).data, enabled: allowed,
    refetchInterval: 15_000, refetchIntervalInBackground: false, retry: 1 });
  const update = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => subscriptionsApi.setUsage(id, enabled),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ['usage'] }); message.success('观测设置已更新'); },
    onError: () => { void cache.invalidateQueries({ queryKey: ['usage'] }); message.error('设置未完成，请刷新确认状态后重试。'); } });
  const prepare = useMutation({ mutationFn: ({ id, restart }: { id: string; restart: boolean }) => usageApi.prepare(id, restart),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ['usage'] }); message.success('服务器验证通过，请在客户端更新订阅'); },
    onError: () => { void cache.invalidateQueries({ queryKey: ['usage'] }); message.error('节点同步未通过，请查看接入状态；未确认的新凭据不会下发。'); } });
  const data = query.data;
  const freshMs = (data?.freshnessSeconds ?? 90) * 1000;
  const activeMs = (data?.activeWindowSeconds ?? 60) * 1000;
  const rows = (data?.rows ?? []).map(row => {
    const stale = !row.sampledAt || now - Date.parse(row.sampledAt) > freshMs;
    const freshStatus: UsageStatus = ['ACTIVE', 'IDLE', 'STALE'].includes(row.status)
      ? stale ? 'STALE' : row.lastActiveAt && now - Date.parse(row.lastActiveAt) <= activeMs ? 'ACTIVE' : 'IDLE' : row.status;
    return { ...row, status: freshStatus, upRate: stale ? null : row.upRate, downRate: stale ? null : row.downRate };
  });
  const scoped = rows.filter(r => !subscription || r.subscriptionId === subscription);
  const filtered = scoped.filter(r => (!status || r.status === status) && `${r.subjectName} ${r.subscriptionName} ${r.nodeName} ${r.candidateIp}`.toLowerCase().includes(search.toLowerCase()));
  filtered.sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || (b.downRate ?? -1) - (a.downRate ?? -1));
  const selected = rows.find(r => r.id === selectedId);
  const active = scoped.filter(r => r.status === 'ACTIVE');
  const css = { '--usage-muted': token.colorTextSecondary, '--usage-border': token.colorBorderSecondary, '--usage-bg': token.colorBgContainer, '--usage-fill': token.colorFillQuaternary } as CSSProperties;
  const openPrepare = (id: string, name: string, prepared: boolean) => modal.confirm({ title: prepared ? `同步 ${name} 的凭据？` : `准备 ${name} 的观测能力？`,
    content: prepared ? '只同步认证身份，不重启节点。新凭据经持久化和运行验证后才会进入订阅。'
      : '首次准备可能需要重启此节点，现有连接会短暂重连。系统保留旧凭据并准备回退；其他节点不受影响。请在维护窗口执行。',
    okText: prepared ? '同步凭据' : '确认准备节点', cancelText: '取消',
    onOk: () => prepare.mutateAsync({ id, restart: !prepared }),
  });
  const toggle = (id: string, enabled: boolean) => modal.confirm({ title: enabled ? '开启服务端使用观测？' : '暂停使用观测？',
    content: enabled ? '为该订阅生成独立授权身份。无需安装电脑软件；仅观察节点、候选配置和流量，不采集访问网站。开启后仍需准备节点，最后更新客户端订阅。'
      : '停止发布新的观测凭据和记录此订阅的身份流量。已有代理凭据继续可用，不会断开连接。',
    okText: enabled ? '开启观测' : '暂停观测', cancelText: '取消', onOk: () => update.mutateAsync({ id, enabled }),
  });
  if (user && !allowed) return <Result status="403" title="无权查看使用观测" subTitle="此页面仅对资源所有者开放。" />;
  return <div className={styles.page} style={css}>
    <PageHeader title="使用观测" extra={<Button icon={<ReloadOutlined spin={query.isFetching} />} onClick={() => query.refetch()} loading={query.isFetching}>刷新状态</Button>} />
    <div className={styles.intro}>
      <div><div className={styles.eyebrow}>SERVER-SIDE OBSERVABILITY</div><Typography.Title level={3} style={{ margin: '0 0 8px', fontSize: isMobile ? 22 : 26 }}>从发布配置，到真实使用</Typography.Title>
        <p className={styles.description}>查看授权身份实际使用的节点与候选配置。无需电脑采集器，始终保留 CDN；不把订阅下载、自动测速或过期数据当作用户在线证明。</p></div>
      <Tag icon={<SafetyCertificateOutlined />} style={{ margin: 0 }}>无需客户端安装</Tag>
    </div>
    {query.isError && <Alert className={styles.notice} type="error" showIcon message="状态刷新失败" description="已保留上次结果，并按采样时间判断是否过期。刷新不会触发云端测速。" action={<Button onClick={() => query.refetch()}>重试</Button>} />}
    {data && !data.enabled && <Alert className={styles.notice} type="info" showIcon message="服务端观测尚未启用" description="管理员完成迁移和 Agent 升级后，可开启 USAGE_OBSERVATION_ENABLED。当前订阅与代理转发不受影响。" />}
    {data?.limited && <Alert className={styles.notice} type="warning" showIcon message="当前展示最多 1,000 条候选身份，汇总仅覆盖展示范围。" />}
    {query.isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : data && <>
      <div className={styles.metrics}>
        {[
          { icon: <TeamOutlined />, label: '近期活动身份', value: new Set(active.map(r => r.subjectId)).size, hint: '近 60 秒有流量 · 非人数或设备数' },
          { icon: <ArrowDownOutlined />, label: '活动授权路径', value: active.length, hint: '授权身份 × 节点 × 候选配置' },
          { icon: <CloudServerOutlined />, label: '新鲜上报节点', value: `${data.nodes.filter(n => n.fresh && n.sampledAt && now - Date.parse(n.sampledAt) <= freshMs).length} / ${data.nodes.filter(n => n.preparedAt && n.observing).length}`, hint: '全部订阅 · 90 秒内有效采样' },
          { icon: <InfoCircleOutlined />, label: '旧共享凭据活动', value: data.nodes.filter(n => n.fresh && n.sampledAt && now - Date.parse(n.sampledAt) <= freshMs && n.legacyActiveAt && now - Date.parse(n.legacyActiveAt) <= activeMs).length, hint: '全部订阅 · 节点数，无法归属具体用户' },
        ].map(m => <div className={styles.metric} key={m.label}><div className={styles.metricLabel}>{m.icon}{m.label}</div><div className={styles.metricValue}>{data.enabled ? m.value : '—'}</div><div className={styles.metricHint}>{m.hint}</div></div>)}
      </div>
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'activity', label: '活跃使用', children: <div className={styles.surface}>
          <div className={styles.toolbar}><div className={styles.filters}>
            <Input aria-label="搜索使用记录" placeholder="搜索身份、节点或 IP" prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} allowClear style={{ width: isMobile ? '100%' : 240 }} />
            <Select aria-label="筛选订阅" placeholder="全部订阅" value={subscription} onChange={setSubscription} allowClear style={{ width: 160 }} options={data.subscriptions.map(s => ({ value: s.id, label: s.name }))} />
            <Select aria-label="筛选观测状态" placeholder="全部状态" value={status} onChange={setStatus} allowClear style={{ width: 160 }} options={Object.entries(statuses).map(([value, s]) => ({ value, label: s.label }))} />
          </div><Typography.Text type="secondary">{filtered.length} 条授权路径</Typography.Text></div>
          {!filtered.length ? <Empty style={{ padding: '44px 16px' }} description={search || status || subscription ? '没有符合筛选条件的记录' : '尚无观测身份。开启订阅、准备节点后，更新客户端订阅即可开始。'}>
            {search || status || subscription ? <Button onClick={() => { setSearch(''); setStatus(undefined); setSubscription(undefined); }}>清除筛选</Button> : <Button type="primary" onClick={() => setTab('coverage')}>查看接入步骤</Button>}
          </Empty> : isMobile ? <div className={styles.cards}>{filtered.slice(0, 100).map(r => <article className={styles.mobileCard} key={r.id}>
            <div className={styles.cardTop}><div className={styles.cell}><Typography.Text strong>{r.subjectName}</Typography.Text><span className={styles.secondary}>{r.subscriptionName} · {r.grantKind === 'OWNER' ? '所有者' : '分享接收者'}</span></div><State value={r.status} /></div>
            <div className={styles.cardGrid}><div><div className={styles.secondary}>服务端节点</div>{r.nodeName}</div><div><div className={styles.secondary}>候选配置</div>{carrierNames[r.carrier] ?? r.carrier}<div className={styles.mono}>{r.candidateIp}</div></div>
              <div><div className={styles.secondary}>下载 / 上传</div>{rate(r.downRate)} / {rate(r.upRate)}</div><Button onClick={() => setSelectedId(r.id)} aria-label={`查看 ${r.subjectName} 在 ${r.nodeName} 的证据`}>查看证据</Button></div>
          </article>)}{filtered.length > 100 && <Typography.Text type="secondary">移动端展示前 100 条，请使用筛选缩小范围。</Typography.Text>}</div>
          : <Table rowKey="id" dataSource={filtered} pagination={{ pageSize: 20, showSizeChanger: false, showTotal: n => `共 ${n} 条授权路径` }} scroll={{ x: 1020 }} columns={[
            { title: '授权身份 / 订阅', key: 'subject', width: 190, render: (_, r) => <div className={styles.cell}><Typography.Text strong>{r.subjectName}</Typography.Text><span className={styles.secondary}>{r.subscriptionName} · {r.grantKind === 'OWNER' ? '所有者' : '分享接收者'}</span></div> },
            { title: '服务端节点', dataIndex: 'nodeName', width: 170, ellipsis: true },
            { title: '候选配置指定 IP', key: 'candidate', width: 190, render: (_, r) => <div className={styles.cell}><span className={styles.mono}>{r.candidateIp}</span><span className={styles.secondary}>{carrierNames[r.carrier] ?? r.carrier} · 实际拨入 IP 未验证</span></div> },
            { title: '观测状态', key: 'status', width: 155, render: (_, r) => <State value={r.status} /> },
            { title: '采样速率', key: 'rate', width: 150, render: (_, r) => <div className={styles.cell}><span className={styles.mono}><ArrowDownOutlined /> {rate(r.downRate)}</span><span className={styles.secondary}><ArrowUpOutlined /> {rate(r.upRate)}</span></div> },
            { title: '最近活动', key: 'last', width: 155, render: (_, r) => <span className={styles.secondary}>{time(r.lastActiveAt)}</span> },
            { title: '', key: 'actions', width: 95, render: (_, r) => <Button type="link" onClick={() => setSelectedId(r.id)} aria-label={`查看 ${r.subjectName} 在 ${r.nodeName} 的证据`}>详情</Button> },
          ]} />}
        </div> },
        { key: 'optimization', label: '优选状态', children: <div className={styles.surface}><div className={styles.section}><CfUsageStatus nodes={data.nodes} subscriptions={data.subscriptions} /></div></div> },
        { key: 'coverage', label: '接入与覆盖', children: <div className={styles.surface}><div className={styles.section}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>三步接入，无需安装电脑软件</Typography.Title>
          <Steps className={styles.steps} size="small" direction={isMobile ? 'vertical' : 'horizontal'} items={[{ title: '开启订阅观测', description: '生成独立授权身份' }, { title: '准备服务器节点', description: '首次可能短暂重连' }, { title: '更新客户端订阅', description: '原链接不变，自动携带凭据' }]} />
          <Alert type="info" showIcon message="目前覆盖托管的 VLESS + WS + TLS CDN 节点" description="普通节点和外部节点保持原样。关闭观测不会断开已有连接；删除分享后的凭据撤销需等待服务器确认。" />
          <Typography.Title level={5}>订阅</Typography.Title>
          {!data.subscriptions.length && <Empty description="暂无可管理的订阅" />}
          {data.subscriptions.map(s => <div className={styles.node} key={s.id}><div><Typography.Text strong>{s.name}</Typography.Text><div className={styles.secondary}>{s.enabled ? '已开启 · 新凭据验证通过后才下发' : '未开启 · 原有订阅保持不变'}{s.externalCount > 0 && ` · ${s.externalCount} 个外部节点不在观测范围`}</div></div><Switch aria-label={`${s.name} 服务端观测`} checked={s.enabled} disabled={(!data.enabled && !s.enabled) || update.isPending} onChange={v => toggle(s.id, v)} checkedChildren="开启" unCheckedChildren="关闭" /></div>)}
          <Typography.Title level={5} style={{ marginTop: 28 }}>节点准备情况</Typography.Title>
          {data.nodes.map(n => <div className={styles.node} key={n.id}><div><Space wrap><Typography.Text strong>{n.name}</Typography.Text><Tag color={n.error ? 'orange' : n.preparedAt ? 'blue' : undefined}>{!n.eligible ? '不在观测范围' : n.error ? '需要处理' : n.preparedAt ? '已准备' : '待准备'}</Tag></Space>
            <div className={styles.secondary}>{n.error ? errors[n.error] ?? '准备未通过，请检查节点配置与权限' : n.preparedAt ? `最近同步：${time(n.syncedAt)}` : '保留旧凭据，准备前不会改变订阅认证'}</div>
            <div className={styles.secondary}>Agent {n.agentVersion ?? '未上报'} · 本功能需要 1.8.0+ · <a href={`/servers/${encodeURIComponent(n.serverId)}`}>查看服务器</a></div></div>
            {n.eligible && <Button disabled={!data.enabled || prepare.isPending || (!n.preparedAt && !n.observing)} onClick={() => openPrepare(n.id, n.name, !!n.preparedAt)}>{n.preparedAt ? '同步凭据' : '准备节点'}</Button>}</div>)}
        </div></div> },
      ]} />
      <div className={styles.footnote}><SafetyCertificateOutlined /> 仅记录授权身份、节点、候选配置与聚合流量，不记录访问网站。自动健康检查也可能产生流量；同一授权身份不等于一个人或一台设备。<br />最后获取：{time(data.asOf)} · 每 15 秒刷新 · 刷新状态不产生云端探针费用。</div>
    </>}
    <Drawer title="使用证据" open={!!selectedId} onClose={() => setSelectedId(undefined)} width={isMobile ? '100%' : 600} styles={{ body: css }}>
      {!selected ? <Empty description="记录已不在当前结果中，请刷新后重新选择。" /> : <>
        <Space wrap style={{ marginBottom: 18 }}><Typography.Title level={4} style={{ margin: 0 }}>{selected.subjectName}</Typography.Title><State value={selected.status} /></Space>
        <div className={styles.evidence}><SafetyCertificateOutlined /> <strong>服务端认证与流量证据</strong><br />{selected.lastActiveAt ? '已观测到此凭据的流量增长，证明该身份曾在此节点被使用。' : '尚未观测到此凭据的流量增长；仅有配置发布或凭据同步不能证明已经使用。'}不证明客户端实际拨入的 CF IP，也不证明有人正在操作。到达源站之前的 timeout 不在此观测范围。</div>
        <Tabs items={[{ key: 'evidence', label: '归因与时间', children: <Descriptions column={1} size="small" items={[
          { key: 'sub', label: '订阅', children: selected.subscriptionName }, { key: 'node', label: '服务端节点', children: selected.nodeName },
          { key: 'label', label: '候选配置', children: <span style={{ overflowWrap: 'anywhere' }}>{selected.label}</span> },
          { key: 'ip', label: '配置指定 CF IP', children: <span className={styles.mono}>{selected.candidateIp}</span> },
          { key: 'actual', label: '实际拨入 CF IP', children: '未独立验证' }, { key: 'installed', label: '凭据验证', children: time(selected.installedAt) },
          { key: 'sample', label: '最近成功采样', children: time(selected.sampledAt) }, { key: 'active', label: '最近流量增长', children: time(selected.lastActiveAt) },
        ]} /> }, { key: 'history', label: '流量趋势', children: <UsageHistory id={selected.id} /> }]} />
      </>}
    </Drawer>
  </div>;
}
