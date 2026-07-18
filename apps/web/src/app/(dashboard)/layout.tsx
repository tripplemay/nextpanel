'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Layout, Menu, Typography, Avatar, Dropdown, Space, Drawer, Button, Grid, Breadcrumb } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import {
  CloudServerOutlined,
  NodeIndexOutlined,
  LinkOutlined,
  AuditOutlined,
  DashboardOutlined,
  LogoutOutlined,
  UserOutlined,
  SettingOutlined,
  TeamOutlined,
  KeyOutlined,
  CloudOutlined,
  LockOutlined,
  MenuOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ImportOutlined,
  StarOutlined,
  ApiOutlined,
  SunOutlined,
  MoonOutlined,
  DesktopOutlined,
  CheckOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/auth';
import { authApi } from '@/lib/api';
import { useThemeMode, useThemeTokens } from '@/theme/ThemeContext';
import type { ThemeMode } from '@/theme/ThemeContext';
import WelcomeModal from '@/components/common/WelcomeModal';
import ServerFormModal from '@/components/servers/ServerFormModal';
import CommandPalette from '@/components/common/CommandPalette';
import 'flag-icons/css/flag-icons.min.css';

const { useBreakpoint } = Grid;

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const baseMenuItems: ItemType[] = [
  { key: '/servers', icon: <CloudServerOutlined />, label: '服务器' },
  { key: '/nodes', icon: <NodeIndexOutlined />, label: '节点管理' },
  { key: '/nodes-v2', icon: <NodeIndexOutlined />, label: '节点拓扑' },
  { key: '/external-nodes', icon: <ImportOutlined />, label: '外部节点' },
  { key: '/subscriptions', icon: <LinkOutlined />, label: '订阅管理' },
  { key: '/recommends', icon: <StarOutlined />, label: '服务器推荐' },
  { key: '/audit-logs', icon: <AuditOutlined />, label: '审计日志' },
  {
    key: 'settings',
    icon: <SettingOutlined />,
    label: '系统设置',
    children: [
      { key: '/settings/cloudflare', icon: <CloudOutlined />, label: 'Cloudflare DNS' },
      { key: '/settings/wxwork', icon: <TeamOutlined />, label: '企业微信' },
      { key: '/settings/openrouter', icon: <ApiOutlined />, label: 'OpenRouter' },
      { key: '/settings/recommends', icon: <StarOutlined />, label: '服务器推荐' },
      { key: '/settings/account', icon: <LockOutlined />, label: '账户安全' },
    ],
  },
];

const adminMenuItems: ItemType[] = [
  { type: 'divider' },
  {
    type: 'group',
    label: '管理员',
    children: [
      { key: '/users', icon: <TeamOutlined />, label: '用户管理' },
      { key: '/invite-codes', icon: <KeyOutlined />, label: '邀请码' },
    ],
  },
];

/** 路由路径 → 中文名（面包屑与选中态匹配共用） */
const pathLabels: Record<string, string> = {
  '/servers': '服务器',
  '/nodes': '节点管理',
  '/nodes-v2': '节点拓扑',
  '/external-nodes': '外部节点',
  '/subscriptions': '订阅管理',
  '/recommends': '服务器推荐',
  '/audit-logs': '审计日志',
  '/users': '用户管理',
  '/invite-codes': '邀请码',
  '/settings': '系统设置',
  '/settings/cloudflare': 'Cloudflare DNS',
  '/settings/wxwork': '企业微信',
  '/settings/openrouter': 'OpenRouter',
  '/settings/recommends': '服务器推荐管理',
  '/settings/account': '账户安全',
};

const routeKeys = Object.keys(pathLabels).filter((k) => k !== '/settings');

/** 底部 Tab Bar（移动端高频路径） */
const mobileTabs = [
  { key: '/servers', icon: <CloudServerOutlined />, label: '服务器' },
  { key: '/nodes', icon: <NodeIndexOutlined />, label: '节点' },
  { key: '/subscriptions', icon: <LinkOutlined />, label: '订阅' },
  { key: '/settings/account', icon: <UserOutlined />, label: '我的' },
];

const themeModeOptions: { key: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { key: 'light', label: '亮色', icon: <SunOutlined /> },
  { key: 'dark', label: '暗色', icon: <MoonOutlined /> },
  { key: 'system', label: '跟随系统', icon: <DesktopOutlined /> },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, logout } = useAuthStore();
  const { mode, resolvedMode, setMode } = useThemeMode();
  const tokens = useThemeTokens();
  const [hydrated, setHydrated] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [addServerOpen, setAddServerOpen] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  useEffect(() => {
    setHydrated(true);
    if (localStorage.getItem('showWelcome') === '1') {
      localStorage.removeItem('showWelcome');
      setWelcomeOpen(true);
    }
  }, []);

  useEffect(() => {
    if (hydrated && !token) router.replace('/login');
  }, [hydrated, token, router]);

  useEffect(() => {
    if (pathname?.startsWith('/settings')) {
      setOpenKeys((prev) => (prev.includes('settings') ? prev : [...prev, 'settings']));
    }
  }, [pathname]);

  if (!hydrated || !token) return null;

  // 选中态取最长前缀匹配（详情页高亮列表菜单）
  const selectedKey =
    routeKeys
      .filter((k) => pathname === k || pathname.startsWith(k + '/'))
      .sort((a, b) => b.length - a.length)[0] ?? pathname;

  // 面包屑
  const segments = pathname.split('/').filter(Boolean);
  const breadcrumbItems = segments.map((seg, i) => {
    const path = '/' + segments.slice(0, i + 1).join('/');
    const label = pathLabels[path] ?? '详情';
    const isLast = i === segments.length - 1;
    return {
      key: path,
      title: isLast ? (
        label
      ) : (
        <a onClick={() => (path === '/settings' ? undefined : router.push(path))}>{label}</a>
      ),
    };
  });

  const userMenu: ItemType[] = [
    {
      key: 'account',
      icon: <LockOutlined />,
      label: '账户安全',
      onClick: () => router.push('/settings/account'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: async () => {
        try { await authApi.logout(); } catch { /* 本地状态仍需清除 */ }
        logout();
        router.push('/login');
      },
    },
  ];

  const visibleBaseMenuItems = isMobile
    ? baseMenuItems.filter((item) => item?.key !== '/nodes-v2')
    : baseMenuItems;
  const menuItems = user?.role === 'ADMIN' ? [...visibleBaseMenuItems, ...adminMenuItems] : visibleBaseMenuItems;

  const sidebarContent = (isCollapsed: boolean) => (
    <>
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: isCollapsed ? 'center' : 'flex-start',
          padding: isCollapsed ? 0 : '0 20px',
          gap: 10,
          borderBottom: `1px solid ${tokens.sidebarBorder}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 2px 6px rgba(22, 119, 255, 0.35)',
          }}
        >
          <DashboardOutlined style={{ color: '#fff', fontSize: 17 }} />
        </div>
        {!isCollapsed && (
          <Text strong style={{ fontSize: 16, letterSpacing: 0.2 }}>
            NextPanel
          </Text>
        )}
      </div>
      <Menu
        theme={resolvedMode === 'dark' ? 'dark' : 'light'}
        mode="inline"
        selectedKeys={[selectedKey]}
        openKeys={isCollapsed ? undefined : openKeys}
        onOpenChange={setOpenKeys}
        onClick={({ key }) => {
          if (!key.startsWith('settings')) {
            router.push(key);
            setDrawerOpen(false);
          }
        }}
        items={menuItems}
        style={{ marginTop: 8, background: 'transparent' }}
      />
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider
          width={220}
          collapsedWidth={72}
          collapsed={collapsed}
          trigger={null}
          className="np-sidebar"
          style={{
            background: tokens.sidebarBg,
            borderRight: `1px solid ${tokens.sidebarBorder}`,
            position: 'sticky',
            top: 0,
            height: '100vh',
            overflow: 'auto',
            transition: 'background-color 0.2s ease',
          }}
        >
          {sidebarContent(collapsed)}
        </Sider>
      )}

      <Drawer
        open={isMobile && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        placement="left"
        width={240}
        className="np-sidebar"
        styles={{ body: { padding: 0, background: tokens.sidebarBg }, header: { display: 'none' } }}
      >
        {sidebarContent(false)}
      </Drawer>

      <Layout>
        <Header
          style={{
            background: tokens.headerBg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${tokens.sidebarBorder}`,
            position: 'sticky',
            top: 0,
            zIndex: 100,
            height: 64,
            lineHeight: 'normal',
          }}
        >
          <Space size={12}>
            {isMobile ? (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setDrawerOpen(true)}
                style={{ fontSize: 18 }}
              />
            ) : (
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
              />
            )}
            {!isMobile && <Breadcrumb items={breadcrumbItems} />}
          </Space>

          <Space size={4}>
            <CommandPalette />
            <Dropdown
              menu={{
                items: themeModeOptions.map((opt) => ({
                  key: opt.key,
                  icon: opt.icon,
                  label: (
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      {opt.label}
                      {mode === opt.key && <CheckOutlined style={{ color: '#1677ff' }} />}
                    </Space>
                  ),
                  onClick: () => setMode(opt.key),
                })),
              }}
              placement="bottomRight"
              trigger={['click']}
            >
              <Button
                type="text"
                icon={resolvedMode === 'dark' ? <MoonOutlined /> : <SunOutlined />}
                aria-label="切换主题"
              />
            </Dropdown>
            <Dropdown menu={{ items: userMenu }} placement="bottomRight">
              <Space style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }}>
                <Avatar size="small" style={{ background: '#1677ff', fontSize: 12 }}>
                  {user?.username?.[0]?.toUpperCase() ?? <UserOutlined />}
                </Avatar>
                {!isMobile && <Text>{user?.username}</Text>}
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ background: tokens.contentBg }}>
          <div
            style={{
              maxWidth: 1600,
              margin: '0 auto',
              padding: isMobile ? 12 : 24,
              paddingBottom: isMobile ? 88 : 24,
            }}
          >
            {children}
          </div>
        </Content>
      </Layout>

      {/* 移动端底部 Tab Bar */}
      {isMobile && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            display: 'flex',
            background: tokens.headerBg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderTop: `1px solid ${tokens.sidebarBorder}`,
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {mobileTabs.map((tab) => {
            const active = selectedKey === tab.key;
            return (
              <div
                key={tab.key}
                onClick={() => router.push(tab.key)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  padding: '8px 0 6px',
                  cursor: 'pointer',
                  color: active ? '#1677ff' : undefined,
                  transition: 'color 0.2s ease',
                }}
              >
                <span style={{ fontSize: 20, display: 'flex' }}>{tab.icon}</span>
                <span style={{ fontSize: 11 }}>{tab.label}</span>
              </div>
            );
          })}
        </div>
      )}

      <WelcomeModal
        open={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
        onAddServer={() => setAddServerOpen(true)}
      />
      <ServerFormModal
        open={addServerOpen}
        initialValues={null}
        onClose={() => setAddServerOpen(false)}
        onSuccess={(server) => {
          setAddServerOpen(false);
          if (server?.id) {
            router.push(`/servers?install=${server.id}`);
          }
        }}
      />
    </Layout>
  );
}
