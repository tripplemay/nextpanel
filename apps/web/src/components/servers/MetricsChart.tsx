'use client';

import { Col, Row, Typography, theme as antdTheme } from 'antd';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useThemeTokens } from '@/theme/ThemeContext';
import { statusColors } from '@/theme/semantic';

const { Text } = Typography;

export interface MetricsChartPoint {
  time: string;
  CPU: number;
  内存: number;
  磁盘: number;
  上传: number;
  下载: number;
}

function formatRate(bytes: number): string {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
}

interface MetricsChartProps {
  data: MetricsChartPoint[];
  timeRange: string | null;
}

/**
 * 服务器资源趋势图（recharts）。
 * 该组件经 next/dynamic 按需加载，避免 recharts 进入首屏包。
 */
export default function MetricsChart({ data, timeRange }: MetricsChartProps) {
  const tokens = useThemeTokens();
  const { token } = antdTheme.useToken();

  // recharts 主题化样式（亮/暗主题自适应）
  const chartTooltipProps = {
    contentStyle: {
      background: token.colorBgElevated,
      border: `1px solid ${token.colorBorder}`,
      borderRadius: token.borderRadiusLG,
      color: token.colorText,
      fontSize: 12,
    },
    labelStyle: { color: token.colorText },
  } as const;
  const axisTick = { fontSize: 11, fill: tokens.chartText };

  return (
    <Row gutter={16}>
      <Col xs={24} xl={12}>
        <Text type="secondary" style={{ fontSize: 12 }}>CPU / 内存 / 磁盘 (%)</Text>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="gradCpu" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={statusColors.info} stopOpacity={0.25} />
                <stop offset="95%" stopColor={statusColors.info} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradMem" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={statusColors.success} stopOpacity={0.25} />
                <stop offset="95%" stopColor={statusColors.success} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDisk" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={statusColors.warning} stopOpacity={0.25} />
                <stop offset="95%" stopColor={statusColors.warning} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={tokens.chartGrid} />
            <XAxis dataKey="time" tick={axisTick} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} tick={axisTick} unit="%" />
            <Tooltip formatter={(v) => (v != null ? `${v}%` : '')} {...chartTooltipProps} />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => <span style={{ color: token.colorText }}>{value}</span>}
            />
            <Area type="monotone" dataKey="CPU" stroke={statusColors.info} fill="url(#gradCpu)" dot={false} strokeWidth={1.5} />
            <Area type="monotone" dataKey="内存" stroke={statusColors.success} fill="url(#gradMem)" dot={false} strokeWidth={1.5} />
            <Area type="monotone" dataKey="磁盘" stroke={statusColors.warning} fill="url(#gradDisk)" dot={false} strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </Col>
      <Col xs={24} xl={12}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          网络流量 (KB/s){timeRange ? `　${timeRange}` : ''}
        </Text>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="gradUp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={statusColors.success} stopOpacity={0.25} />
                <stop offset="95%" stopColor={statusColors.success} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDown" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={statusColors.info} stopOpacity={0.25} />
                <stop offset="95%" stopColor={statusColors.info} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={tokens.chartGrid} />
            <XAxis dataKey="time" tick={axisTick} interval="preserveStartEnd" />
            <YAxis tick={axisTick} unit=" KB/s" />
            <Tooltip formatter={(v) => (v != null ? formatRate(Number(v) * 1024) : '')} {...chartTooltipProps} />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value) => <span style={{ color: token.colorText }}>{value}</span>}
            />
            <Area type="monotone" dataKey="上传" stroke={statusColors.success} fill="url(#gradUp)" dot={false} strokeWidth={1.5} />
            <Area type="monotone" dataKey="下载" stroke={statusColors.info} fill="url(#gradDown)" dot={false} strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </Col>
    </Row>
  );
}
