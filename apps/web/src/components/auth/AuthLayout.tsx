'use client';

import { Grid, Typography } from 'antd';
import {
  DashboardOutlined,
  CloudServerOutlined,
  NodeIndexOutlined,
  LinkOutlined,
  ImportOutlined,
} from '@ant-design/icons';

const { useBreakpoint } = Grid;
const { Title, Text } = Typography;

const features = [
  {
    icon: <CloudServerOutlined style={{ fontSize: 18 }} />,
    title: '服务器管理',
    desc: 'SSH 接入，实时监控',
  },
  {
    icon: <NodeIndexOutlined style={{ fontSize: 18 }} />,
    title: '节点部署',
    desc: '一键部署 Xray / Sing-Box',
  },
  {
    icon: <LinkOutlined style={{ fontSize: 18 }} />,
    title: '订阅管理',
    desc: '支持 Hiddify / Clash / Sing-Box 客户端',
  },
  {
    icon: <ImportOutlined style={{ fontSize: 18 }} />,
    title: '节点托管',
    desc: '托管已有节点，统一订阅管理',
  },
];

interface Props {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: Props) {
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      {/* 左侧品牌区 */}
      {!isMobile && (
        <div
          style={{
            width: 420,
            flexShrink: 0,
            background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '48px 40px',
          }}
        >
          {/* Logo + 标题 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <DashboardOutlined style={{ fontSize: 32, color: '#fff' }} />
            <Title level={2} style={{ margin: 0, color: '#fff' }}>
              NextPanel
            </Title>
          </div>
          <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, marginBottom: 48 }}>
            数据加密通道管理面板
          </Text>

          {/* 特性列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {features.map((f) => (
              <div
                key={f.title}
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  borderRadius: 12,
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  color: '#fff',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{f.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 底部版权 */}
          <Text
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 12,
              marginTop: 'auto',
              paddingTop: 48,
            }}
          >
            © 2025 NextPanel
          </Text>
        </div>
      )}

      {/* 右侧表单区 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fff',
          padding: 24,
        }}
      >
        <div style={{ width: '100%', maxWidth: 380 }}>
          {/* 移动端显示 Logo */}
          {isMobile && (
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <DashboardOutlined style={{ fontSize: 28, color: '#1677ff' }} />
              <Title level={3} style={{ marginTop: 8, marginBottom: 4 }}>
                NextPanel
              </Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                数据加密通道管理面板
              </Text>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
