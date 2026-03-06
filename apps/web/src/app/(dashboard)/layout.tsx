'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Layout, Menu, Typography, Avatar, Dropdown, Space, Drawer, Button, Grid } from 'antd';
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
} from '@ant-design/icons';
import { useAuthStore } from '@/store/auth';

const { useBreakpoint } = Grid;

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const baseMenuItems: ItemType[] = [
  { key: '/servers', icon: <CloudServerOutlined />, label: '服务器' },
  { key: '/nodes', icon: <NodeIndexOutlined />, label: '节点' },
  { key: '/subscriptions', icon: <LinkOutlined />, label: '订阅管理' },
  { key: '/audit-logs', icon: <AuditOutlined />, label: '审计日志' },
  {
    key: 'settings',
    icon: <SettingOutlined />,
    label: '系统设置',
    children: [
      { key: '/settings/cloudflare', icon: <CloudOutlined />, label: 'Cloudflare DNS' },
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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, logout } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  useEffect(() => {
    setHydrated(true);
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

  const userMenu = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => {
        logout();
        router.push('/login');
      },
    },
  ];

  const menuItems = user?.role === 'ADMIN' ? [...baseMenuItems, ...adminMenuItems] : baseMenuItems;

  const sidebarContent = (
    <>
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0,
        }}
      >
        <DashboardOutlined style={{ color: '#1677ff', fontSize: 20, marginRight: 8 }} />
        <Text strong style={{ color: '#fff', fontSize: 16 }}>
          NextPanel
        </Text>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[pathname]}
        openKeys={openKeys}
        onOpenChange={setOpenKeys}
        onClick={({ key }) => {
          if (!key.startsWith('settings')) {
            router.push(key);
            setDrawerOpen(false);
          }
        }}
        items={menuItems}
        style={{ marginTop: 8 }}
      />
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider width={220} theme="dark">
          {sidebarContent}
        </Sider>
      )}

      <Drawer
        open={isMobile && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        placement="left"
        width={220}
        styles={{ body: { padding: 0, background: '#001529' }, header: { display: 'none' } }}
      >
        {sidebarContent}
      </Drawer>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          {isMobile ? (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setDrawerOpen(true)}
              style={{ fontSize: 18 }}
            />
          ) : (
            <div />
          )}
          <Dropdown menu={{ items: userMenu }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} size="small" />
              {!isMobile && <Text>{user?.username}</Text>}
            </Space>
          </Dropdown>
        </Header>

        <Content style={{ margin: isMobile ? 12 : 24, background: '#f5f7fa' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
