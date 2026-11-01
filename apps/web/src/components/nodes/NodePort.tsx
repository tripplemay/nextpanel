'use client';

import { Button, Popover, Space, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Node } from '@/types/api';
import { cfEndpointReady } from '@/lib/cf-origin';

export default function NodePort({ node }: { node: Node }) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (node.publicPort == null) return;
    const timer = setInterval(() => refresh(value => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [node.publicPort]);
  if (node.publicPort == null) return <span>{node.listenPort}</span>;
  const route = node.cfOriginRoute;
  const ready = cfEndpointReady(node);
  const state = ready ? '配置有效' : route?.state === 'ERROR' ? '回源异常'
    : route?.state === 'READY' ? '核验过期' : route?.state === 'CONFIGURED' ? '待部署验收' : '待配置';
  const detail = <Space direction="vertical" size={8} style={{ maxWidth: 330 }}>
    <Typography.Text>客户端连接 Cloudflare:{node.publicPort}，回源至本机 {node.listenPort}。</Typography.Text>
    <Typography.Text type="secondary">原 443 网站或 WS 服务保持不变。</Typography.Text>
    <Typography.Text>域名：{node.domain ?? '待配置'}</Typography.Text>
    <Typography.Text>回源规则：{route?.ruleId ? '已登记' : '待登记'}</Typography.Text>
    <Typography.Text>最近配置核验：{route?.checkedAt ? new Date(route.checkedAt).toLocaleString() : '尚未完成'}</Typography.Text>
    {route?.error && <Typography.Text type="danger">{route.error}</Typography.Text>}
    <Typography.Text type="secondary">配置核验涵盖回源规则与专用防火墙，不代表客户端测速或源站 IP 完全隐藏。异常或过期的映射不下发。</Typography.Text>
  </Space>;
  return <Space direction="vertical" size={0}>
    <Popover title="Cloudflare 回源映射" content={detail} trigger="click">
      <Button type="link" size="small" style={{ padding: 0 }} aria-label={`查看 ${node.name} 回源端口映射`}>
        {node.publicPort} → {node.listenPort}
      </Button>
    </Popover>
    <Tag color={ready ? 'success' : route?.state === 'ERROR' ? 'error' : 'warning'}>{state}</Tag>
  </Space>;
}
