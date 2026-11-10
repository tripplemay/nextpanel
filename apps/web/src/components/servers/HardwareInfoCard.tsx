'use client';

import { Alert, Col, Descriptions, Row, Space, Tag, Typography } from 'antd';
import Link from 'next/link';
import dayjs from '@/lib/dayjs';
import AppCard from '@/components/common/AppCard';
import type { Server, SystemInfoField } from '@/types/api';

const { Text } = Typography;
const STALE_MS = 2 * 60 * 60 * 1000;

function supportsInventory(version: string | null): boolean | null {
  const match = version?.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return Number(match[1]) > 1 || (Number(match[1]) === 1 && Number(match[2]) >= 9);
}

function formatCapacity(value: string | number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '未获取';
  const unit = value >= 1024 ** 4 ? 'TiB' : value >= 1024 ** 3 ? 'GiB' : 'MiB';
  const divisor = unit === 'TiB' ? 1024 ** 4 : unit === 'GiB' ? 1024 ** 3 : 1024 ** 2;
  return `${(value / divisor).toFixed(2)} ${unit}`;
}

export default function HardwareInfoCard({ server, refreshError = false }: { server: Server; refreshError?: boolean }) {
  const info = server.systemInfo;
  const supported = supportsInventory(server.agentVersion);
  const freshHeartbeat = !!server.lastSeenAt && Date.now() - Date.parse(server.lastSeenAt) <= 120_000;
  const offline = server.status !== 'ONLINE' || !freshHeartbeat;
  const stale = !!info && (!Number.isFinite(Date.parse(info.collectedAt)) || Date.now() - Date.parse(info.collectedAt) > STALE_MS);
  const fields = info?.schemaVersion === 1 ? info.fields : {};
  const missingFields = info?.schemaVersion === 1 ? info.missingFields : [];
  const partial = missingFields.length > 0;

  const field = (key: SystemInfoField, capacity = false) => {
    const entry = fields[key];
    if (!entry) return <Text type="secondary">{key.startsWith('virtualization') ? '未知' : '未获取'}</Text>;
    const old = missingFields.includes(key);
    const value = capacity ? formatCapacity(entry.value) : String(entry.value);
    return (
      <div style={{ overflowWrap: 'anywhere' }}>
        <Text>{value}</Text>
        {old && <div><Text type="warning" style={{ fontSize: 12 }}>
          本次未获取；上次成功 {dayjs(entry.collectedAt).format('YYYY-MM-DD HH:mm')}
        </Text></div>}
      </div>
    );
  };

  const virtualGuest = fields.virtualizationRole?.value === 'guest'
    && ['kvm', 'qemu', 'xen', 'vmware', 'microsoft', 'virtualbox', 'parallels'].includes(String(fields.virtualizationSystem?.value))
    && !missingFields.some(key => ['virtualizationRole', 'virtualizationSystem'].includes(key));

  return (
    <AppCard title="硬件与系统" size="small">
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {refreshError && <Alert type="warning" showIcon title="详情刷新失败，当前显示缓存数据" />}
        {!info ? (
          <Alert type="info" showIcon title={
            supported === false ? '当前 Agent 尚不支持硬件信息' : supported === true ? '等待首次采集' : '等待 Agent 上报硬件信息'
          } description={<>
            {supported === false ? '需要支持硬件采集的 Agent 1.9.0 或更高版本。' : '配置由 Agent 自动采集，不依赖 SSH 凭证。'}
            {' '}<Link href="/servers">前往服务器列表管理 Agent</Link>
          </>} />
        ) : info.schemaVersion !== 1 ? (
          <Alert type="warning" showIcon title="当前面板不支持此硬件信息格式，请升级面板" />
        ) : (
          <>
            <Space wrap size={[8, 8]}>
              <Tag color={offline || stale || partial ? 'warning' : 'success'}>
                {offline ? '离线 / 心跳未确认' : stale ? '配置信息已过期' : partial ? '部分信息未获取' : '采集正常'}
              </Tag>
              <Text type="secondary" title={dayjs(info.collectedAt).format('YYYY-MM-DD HH:mm:ss')}>
                最近采集：{dayjs(info.collectedAt).fromNow()}
              </Text>
              <Text type="secondary">接收：{dayjs(info.receivedAt).format('MM-DD HH:mm')}</Text>
            </Space>
            {(offline || stale || partial) && <Alert type="warning" showIcon title={
              offline ? '显示最后一次采集结果，不代表当前配置已确认' : stale ? '超过 2 小时未收到新配置，心跳在线不代表配置最新' : '未获取的字段显示为空；保留的旧值单独标注原采集时间'
            } />}
            <Row gutter={[24, 16]}>
              <Col xs={24} md={8}>
                <Descriptions title="CPU" column={1} size="small">
                  <Descriptions.Item label="型号">{field('cpuModel')}</Descriptions.Item>
                  <Descriptions.Item label={virtualGuest ? 'vCPU 数' : '逻辑 CPU 数'}>{field('cpuLogicalCores')}</Descriptions.Item>
                  <Descriptions.Item label="架构">{field('architecture')}</Descriptions.Item>
                </Descriptions>
              </Col>
              <Col xs={24} md={8}>
                <Descriptions title="内存" column={1} size="small">
                  <Descriptions.Item label="系统可见总量">{field('memoryTotalBytes', true)}</Descriptions.Item>
                </Descriptions>
              </Col>
              <Col xs={24} md={8}>
                <Descriptions title="根文件系统 /" column={1} size="small">
                  <Descriptions.Item label="容量">{field('rootTotalBytes', true)}</Descriptions.Item>
                  <Descriptions.Item label="文件系统">{field('rootFsType')}</Descriptions.Item>
                </Descriptions>
              </Col>
            </Row>
            <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
              <Descriptions.Item label="发行版">{field('osName')}</Descriptions.Item>
              <Descriptions.Item label="系统版本">{field('osVersion')}</Descriptions.Item>
              <Descriptions.Item label="内核">{field('kernelVersion')}</Descriptions.Item>
              <Descriptions.Item label="虚拟化">{field('virtualizationSystem')}</Descriptions.Item>
              <Descriptions.Item label="虚拟化角色">{field('virtualizationRole')}</Descriptions.Item>
            </Descriptions>
            <Text type="secondary" style={{ fontSize: 12 }}>
              来源：服务器 Agent {info.agentVersion}；启动时及每小时采集。仅代表操作系统可见资源，容器内不代表配额；根文件系统容量不等于整机磁盘总量。
            </Text>
          </>
        )}
      </Space>
    </AppCard>
  );
}
