'use client';

import { Alert, App, Button, Collapse, Empty, Select, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface CleanupTask {
  id: string; serverId: string; serverName: string; nodeName: string;
  role: string; state: string; attempts: number; lastError: string | null;
}
interface Finding {
  id: string; serverId: string; serviceName: string; detail: string; lastSeenAt: string;
}
interface Inventory { tasks: CleanupTask[]; findings: Finding[]; retirements: { id: string; name: string; deleteError: string | null }[] }

export default function ResourceLifecyclePanel({ servers }: { servers: { id: string; name: string }[] }) {
  const [serverId, setServerId] = useState<string>();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const inventory = useQuery({ queryKey: ['resource-lifecycle'], queryFn: async () => (await api.get<Inventory>('/resources')).data, refetchInterval: 15000 });
  const scan = useMutation({
    mutationFn: (id: string) => api.post(`/resources/servers/${id}/scan`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-lifecycle'] }); message.success('资源核对完成；不会自动停止归属不明的服务'); },
    onError: () => message.error('资源核对失败，请检查 SSH 连通性或主机身份'),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/resources/cleanup/${id}/retry`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['resource-lifecycle'] }); message.success('已重新排队，仍会执行身份和归属校验'); },
    onError: () => message.error('无法重试该清理任务'),
  });
  const tasks = inventory.data?.tasks ?? [];
  const findings = inventory.data?.findings ?? [];
  const retirements = inventory.data?.retirements ?? [];
  const scanServers = [...new Map([
    ...findings.map(f => ({ id: f.serverId, name: f.serverId })),
    ...tasks.map(t => ({ id: t.serverId, name: t.serverName })),
    ...retirements,
    ...servers,
  ].map(s => [s.id, s])).values()];
  return <Collapse style={{ marginBottom: 16 }} items={[{
    key: 'resources',
    label: <Space wrap>部署资源核对<Tag color={tasks.length || findings.length || retirements.length ? 'warning' : 'default'}>待清理 {tasks.length} / 待核对 {findings.length} / 待退役 {retirements.length}</Tag></Space>,
    children: <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert type="info" showIcon message="移出面板不等于远程清理完成" description="已授权删除的资源会持久化重试。归属不明的历史服务只报告、不自动停止；重试不会跳过安全校验。" />
      {inventory.isError && <Alert type="error" message="无法读取资源状态" />}
      {retirements.map(s => <Alert key={s.id} type={s.deleteError ? 'warning' : 'info'} message={<><Link href={`/servers/${s.id}`}>{s.name}</Link>：{s.deleteError ?? '等待清理及最终只读核对；凭证暂时保留'}</>} />)}
      <Space wrap>
        <Select aria-label="待核对服务器" placeholder="选择服务器" value={serverId} onChange={setServerId} style={{ width: 240, maxWidth: '100%' }} options={scanServers.map(s => ({ value: s.id, label: s.name }))} />
        <Button disabled={!serverId} loading={scan.isPending} onClick={() => serverId && scan.mutate(serverId)}>只读核对</Button>
      </Space>
      <Table<CleanupTask> rowKey="id" size="small" dataSource={tasks} loading={inventory.isLoading} pagination={{ pageSize: 5 }} scroll={{ x: 600 }} columns={[
        { title: '服务器 / 节点', key: 'name', render: (_, t) => <><Link href={`/servers/${t.serverId}`}>{t.serverName}</Link><br /><Typography.Text type="secondary">{t.nodeName} · {t.role}</Typography.Text></> },
        { title: '状态', dataIndex: 'state', render: (s: string) => <Tag color={s === 'BLOCKED' ? 'error' : 'processing'}>{({ PENDING: '等待重试', RUNNING: '清理中', BLOCKED: '需人工核对' } as Record<string, string>)[s] ?? s}</Tag> },
        { title: '原因', dataIndex: 'lastError', render: (s: string | null) => <Typography.Text style={{ overflowWrap: 'anywhere' }}>{s ?? '等待执行'}</Typography.Text> },
        { title: '操作', key: 'action', render: (_, t) => <Button size="small" disabled={t.state === 'RUNNING' || retry.isPending} onClick={() => retry.mutate(t.id)}>重试</Button> },
      ]} />
      {findings.length ? <Table<Finding> rowKey="id" size="small" dataSource={findings} pagination={{ pageSize: 5 }} scroll={{ x: 500 }} columns={[
        { title: '服务器', dataIndex: 'serverId', render: (id: string) => <Link href={`/servers/${id}`}>{scanServers.find(s => s.id === id)?.name ?? id}</Link> },
        { title: '待核对服务', dataIndex: 'serviceName', render: (s: string) => <Typography.Text style={{ overflowWrap: 'anywhere' }}>{s}</Typography.Text> },
        { title: '处理方式', key: 'policy', render: () => '面板无对应节点，需确认归属；未自动停止' },
      ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未发现归属不明的服务（不代表尚未扫描的服务器已验收）" />}
    </Space>,
  }]} />;
}
