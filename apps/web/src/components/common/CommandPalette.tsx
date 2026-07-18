'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Modal, Typography, theme as antdTheme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  CloudServerOutlined,
  NodeIndexOutlined,
  FileTextOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { serversApi, nodesApi } from '@/lib/api';

const { Text } = Typography;

interface PaletteItem {
  key: string;
  title: string;
  subtitle?: string;
  group: string;
  icon: React.ReactNode;
  path: string;
}

const pageItems: PaletteItem[] = [
  { key: 'p-servers', title: '服务器', group: '页面', icon: <FileTextOutlined />, path: '/servers' },
  { key: 'p-nodes', title: '节点管理', group: '页面', icon: <FileTextOutlined />, path: '/nodes' },
  { key: 'p-nodes-v2', title: '节点拓扑', group: '页面', icon: <FileTextOutlined />, path: '/nodes-v2' },
  { key: 'p-external', title: '外部节点', group: '页面', icon: <FileTextOutlined />, path: '/external-nodes' },
  { key: 'p-subs', title: '订阅管理', group: '页面', icon: <FileTextOutlined />, path: '/subscriptions' },
  { key: 'p-recommends', title: '服务器推荐', group: '页面', icon: <FileTextOutlined />, path: '/recommends' },
  { key: 'p-audit', title: '审计日志', group: '页面', icon: <FileTextOutlined />, path: '/audit-logs' },
  { key: 'p-users', title: '用户管理', group: '页面', icon: <FileTextOutlined />, path: '/users' },
  { key: 'p-invite', title: '邀请码', group: '页面', icon: <FileTextOutlined />, path: '/invite-codes' },
  { key: 'p-account', title: '账户安全', group: '页面', icon: <FileTextOutlined />, path: '/settings/account' },
  { key: 'p-cf', title: 'Cloudflare DNS 设置', group: '页面', icon: <FileTextOutlined />, path: '/settings/cloudflare' },
  { key: 'p-wx', title: '企业微信设置', group: '页面', icon: <FileTextOutlined />, path: '/settings/wxwork' },
  { key: 'p-or', title: 'OpenRouter 设置', group: '页面', icon: <FileTextOutlined />, path: '/settings/openrouter' },
  { key: 'p-rec-admin', title: '服务器推荐管理', group: '页面', icon: <FileTextOutlined />, path: '/settings/recommends' },
];

const MAX_PER_GROUP = 6;

/** Cmd/Ctrl+K 命令面板：搜索页面、服务器、节点并快速跳转 */
export default function CommandPalette() {
  const router = useRouter();
  const { token } = antdTheme.useToken();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data),
    staleTime: 30_000,
    enabled: open,
  });
  const { data: nodes } = useQuery({
    queryKey: ['nodes'],
    queryFn: () => nodesApi.list().then((r) => r.data),
    staleTime: 30_000,
    enabled: open,
  });

  // 全局快捷键
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (text: string | undefined) => text?.toLowerCase().includes(q);

    const pages = q ? pageItems.filter((p) => match(p.title)) : pageItems;
    const serverItems: PaletteItem[] = (servers ?? [])
      .filter((s) => !q || match(s.name) || match(s.ip) || match(s.region ?? undefined) || match(s.provider ?? undefined))
      .slice(0, MAX_PER_GROUP)
      .map((s) => ({
        key: `s-${s.id}`,
        title: s.name,
        subtitle: s.ip,
        group: '服务器',
        icon: <CloudServerOutlined />,
        path: `/servers/${s.id}`,
      }));
    const nodeItems: PaletteItem[] = q
      ? (nodes ?? [])
          .filter((n) => match(n.name) || match(n.protocol))
          .slice(0, MAX_PER_GROUP)
          .map((n) => ({
            key: `n-${n.id}`,
            title: n.name,
            subtitle: `${n.protocol} · 端口 ${n.listenPort}`,
            group: '节点',
            icon: <NodeIndexOutlined />,
            path: '/nodes',
          }))
      : [];

    return [...pages, ...serverItems, ...nodeItems];
  }, [query, servers, nodes]);

  // 输入变化后重置选中项
  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // 选中项滚动可见
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const select = (item: PaletteItem) => {
    close();
    router.push(item.path);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) select(item);
    }
  };

  let lastGroup: string | null = null;

  return (
    <>
      <Button
        type="text"
        icon={<SearchOutlined />}
        onClick={() => setOpen(true)}
        style={{ color: token.colorTextSecondary }}
      >
        <span className="np-cmdk-hint">
          搜索
          <kbd className="np-kbd">⌘K</kbd>
        </span>
      </Button>
      <Modal
        open={open}
        onCancel={close}
        footer={null}
        closable={false}
        width={560}
        style={{ top: 96, maxWidth: '94vw' }}
        styles={{ body: { padding: 0 } }}
        destroyOnHidden
      >
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Input
            autoFocus
            size="large"
            variant="borderless"
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="搜索页面、服务器、节点…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
        </div>
        <div ref={listRef} style={{ maxHeight: 400, overflowY: 'auto', padding: 8 }}>
          {items.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <Text type="secondary">没有匹配的结果</Text>
            </div>
          )}
          {items.map((item, idx) => {
            const groupHeader =
              item.group !== lastGroup ? ((lastGroup = item.group), item.group) : null;
            const active = idx === activeIndex;
            return (
              <div key={item.key}>
                {groupHeader && (
                  <div
                    style={{
                      padding: '8px 12px 4px',
                      fontSize: 12,
                      color: token.colorTextTertiary,
                    }}
                  >
                    {groupHeader}
                  </div>
                )}
                <div
                  data-idx={idx}
                  onClick={() => select(item)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '9px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: active ? token.colorFillTertiary : 'transparent',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <span style={{ color: token.colorTextSecondary, display: 'flex' }}>{item.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14 }}>{item.title}</span>
                    {item.subtitle && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: token.colorTextTertiary }}>
                        {item.subtitle}
                      </span>
                    )}
                  </span>
                  {active && (
                    <kbd className="np-kbd">↵</kbd>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
