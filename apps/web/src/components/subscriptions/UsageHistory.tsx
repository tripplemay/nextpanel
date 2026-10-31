'use client';

import { Alert, Button, Empty, Skeleton, Table, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { usageApi } from '@/lib/api';

const bytes = (v: string) => `${(Number(v) / 1024 / 1024).toFixed(2)} MB`;
export default function UsageHistory({ id }: { id: string }) {
  const { token } = theme.useToken();
  const query = useQuery({ queryKey: ['usage-history', id], queryFn: async () => (await usageApi.history(id)).data, staleTime: 60_000 });
  if (query.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (query.isError) return <Alert type="error" showIcon message="趋势暂时不可用" action={<Button onClick={() => query.refetch()}>重试</Button>} />;
  const data = query.data ?? [];
  if (!data.length) return <Empty description="近 7 天暂无连续采样到的流量；这不代表节点不可用。" />;
  const max = Math.max(...data.map(p => Number(p.upBytes) + Number(p.downBytes)), 1);
  const end = Math.floor(Date.now() / 3600_000) * 3600_000 + 3600_000;
  const start = end - 168 * 3600_000;
  const day = (v: number) => new Date(v).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  return <div>
    <Typography.Paragraph type="secondary">近 7 天 · 小时汇总。空缺时段表示无已观测记录，不代表零流量；不用于计费。</Typography.Paragraph>
    <svg viewBox="0 0 600 195" role="img" aria-label="近 7 天已观测流量，详细数值见下方表格" style={{ width: '100%', height: 'auto', marginBottom: 12 }}>
      {[10, 80, 150].map(y => <line key={y} x1="0" y1={y} x2="600" y2={y} stroke={token.colorBorderSecondary} strokeDasharray={y === 150 ? undefined : '3 4'} />)}
      {data.filter(p => Date.parse(p.timestamp) >= start && Date.parse(p.timestamp) < end).map(p => {
        const height = (Number(p.upBytes) + Number(p.downBytes)) / max * 140;
        const x = (Date.parse(p.timestamp) - start) / (end - start) * 600;
        return <rect key={p.timestamp} x={x} y={150 - height} width={600 / 168 - 1} height={height} rx="1" fill={token.colorPrimary}><title>{new Date(p.timestamp).toLocaleString('zh-CN')}：{bytes(String(Number(p.upBytes) + Number(p.downBytes)))}</title></rect>;
      })}
      <text x="0" y="181" fontSize="12" fill={token.colorTextSecondary}>{day(start)}</text>
      <text x="600" y="181" textAnchor="end" fontSize="12" fill={token.colorTextSecondary}>{day(end - 3600_000)}</text>
      <text x="0" y="25" fontSize="12" fill={token.colorTextSecondary}>最高 {bytes(String(max))} / 小时</text>
    </svg>
    <Table size="small" rowKey="timestamp" dataSource={data} pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }} columns={[
      { title: '时间', dataIndex: 'timestamp', render: (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false }) },
      { title: '上传', dataIndex: 'upBytes', render: bytes, align: 'right' },
      { title: '下载', dataIndex: 'downBytes', render: bytes, align: 'right' },
    ]} />
  </div>;
}
