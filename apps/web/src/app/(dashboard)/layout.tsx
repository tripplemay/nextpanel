'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Layout, Menu, Typography, Avatar, Dropdown, Space } from 'antd';
import {
  CloudServerOutlined,
  NodeIndexOutlined,
  FileTextOutlined,
  LinkOutlined,
  AuditOutlined,
  DashboardOutlined,
  LogoutOutlined,
  UserOutlined,
  GithubOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/auth';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/servers', icon: <CloudServerOutlined />, label: '服务器' },
  { key: '/nodes', icon: <NodeIndexOutlined />, label: '节点' },
  { key: '/templates', icon: <FileTextOutlined />, label: '配置模板' },
  { key: '/subscriptions', icon: <LinkOutlined />, label: '订阅管理' },
  { key: '/github-actions', icon: <GithubOutlined />, label: 'GitHub Actions' },
  { key: '/audit-logs', icon: <AuditOutlined />, label: '审计日志' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, token, logout } = useAuthStore();

  useEffect(() => {
    if (!token) router.replace('/login');
  }, [token, router]);

  if (!token) return null;

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
          onClick={({ key }) => router.push(key)}
          items={menuItems}
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
