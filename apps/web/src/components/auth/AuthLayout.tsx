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
            width: 440,
            flexShrink: 0,
            background:
              'radial-gradient(600px 400px at 20% 0%, rgba(255,255,255,0.18) 0%, transparent 60%), linear-gradient(150deg, #1677ff 0%, #0958d9 45%, #722ed1 100%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '48px 44px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* 点阵纹理装饰 */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              maskImage: 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
              pointerEvents: 'none',
            }}
          />

          {/* Logo + 标题 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, position: 'relative' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.16)',
                border: '1px solid rgba(255,255,255,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(8px)',
              }}
            >
              <DashboardOutlined style={{ fontSize: 24, color: '#fff' }} />
            </div>
            <Title level={2} style={{ margin: 0, color: '#fff', letterSpacing: 0.5 }}>
              NextPanel
            </Title>
          </div>
          <Text
            style={{
              color: 'rgba(255,255,255,0.75)',
              fontSize: 15,
              marginBottom: 44,
              position: 'relative',
            }}
          >
            数据加密通道管理面板
          </Text>

          {/* 特性列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
            {features.map((f) => (
              <div
                key={f.title}
                style={{
                  background: 'rgba(255,255,255,0.10)',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 12,
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  color: '#fff',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.18)',
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
              position: 'relative',
            }}
          >
            © 2025 NextPanel
          </Text>
        </div>
      )}

      {/* 右侧表单区（背景跟随主题，由全局 body 背景承载） */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div style={{ width: '100%', maxWidth: 380 }}>
          {/* 移动端显示 Logo */}
          {isMobile && (
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(22, 119, 255, 0.35)',
                }}
              >
                <DashboardOutlined style={{ fontSize: 26, color: '#fff' }} />
              </div>
              <Title level={3} style={{ marginTop: 12, marginBottom: 4 }}>
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
