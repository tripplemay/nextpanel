'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { MenuProps } from 'antd';
import { Layout, Menu, Typography, Avatar, Dropdown, Space } from 'antd';
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
} from '@ant-design/icons';
import { useAuthStore } from '@/store/auth';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const baseMenuItems: MenuProps['items'] = [
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

const adminMenuItems: MenuProps['items'] = [
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="dark">
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
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
          onClick={({ key }) => { if (!key.startsWith('settings')) router.push(key); }}
          items={user?.role === 'ADMIN' ? [...baseMenuItems, ...adminMenuItems] : baseMenuItems}
          style={{ marginTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <Dropdown menu={{ items: userMenu }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} size="small" />
              <Text>{user?.username}</Text>
            </Space>
          </Dropdown>
        </Header>

        <Content style={{ margin: 24, background: '#f5f7fa' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
