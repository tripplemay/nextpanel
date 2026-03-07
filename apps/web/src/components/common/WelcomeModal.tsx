'use client';

import { useState } from 'react';
import { Modal, Steps, Button, Typography, Space, Card, Row, Col } from 'antd';
import {
  CloudServerOutlined,
  NodeIndexOutlined,
  LinkOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  DeploymentUnitOutlined,
  PlusOutlined,
} from '@ant-design/icons';

const { Title, Paragraph, Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onAddServer: () => void;
}

const features = [
  {
    icon: <CloudServerOutlined style={{ fontSize: 28, color: '#1677ff' }} />,
    title: '服务器管理',
    desc: '通过 SSH 管理你的 VPS，查看实时资源监控',
  },
  {
    icon: <NodeIndexOutlined style={{ fontSize: 28, color: '#52c41a' }} />,
    title: '节点部署',
    desc: '一键部署 Xray / Sing-Box / V2Ray 代理节点',
  },
  {
    icon: <LinkOutlined style={{ fontSize: 28, color: '#722ed1' }} />,
    title: '订阅管理',
    desc: '生成 Clash / V2Ray / Sing-Box 订阅链接',
  },
];

const steps = [
  {
    icon: <CloudServerOutlined />,
    title: '添加服务器',
    desc: '填写服务器 IP 和 SSH 凭证，一键完成接入',
  },
  {
    icon: <DeploymentUnitOutlined />,
    title: '创建节点',
    desc: '选择协议预设，自动生成节点配置',
  },
  {
    icon: <RocketOutlined />,
    title: '一键部署',
    desc: '点击部署，实时查看 SSH 日志，完成后即可使用',
  },
];

export default function WelcomeModal({ open, onClose, onAddServer }: Props) {
  const [current, setCurrent] = useState(0);

  function handleClose() {
    setCurrent(0);
    onClose();
  }

  function handleAddServer() {
    handleClose();
    onAddServer();
  }

  const footer = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Button type="text" onClick={handleClose}>跳过</Button>
      <Space>
        {current > 0 && (
          <Button onClick={() => setCurrent((c) => c - 1)}>上一步</Button>
        )}
        {current < 2 ? (
          <Button type="primary" onClick={() => setCurrent((c) => c + 1)}>下一步</Button>
        ) : (
          <Space>
            <Button onClick={handleClose}>稍后再说</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAddServer}>
              立即添加服务器
            </Button>
          </Space>
        )}
      </Space>
    </div>
  );

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      width={600}
      style={{ maxWidth: '95vw' }}
      footer={footer}
      closable
      destroyOnHidden
    >
      <Steps
        current={current}
        size="small"
        style={{ marginBottom: 32 }}
        items={[
          { title: '欢迎' },
          { title: '快速上手' },
          { title: '开始配置' },
        ]}
      />

      {current === 0 && (
        <div>
          <Title level={4} style={{ textAlign: 'center', marginBottom: 8 }}>
            🎉 欢迎使用 NextPanel
          </Title>
          <Paragraph type="secondary" style={{ textAlign: 'center', marginBottom: 28 }}>
            一个轻量的代理节点管理面板，帮助你快速部署和管理代理服务
          </Paragraph>
          <Row gutter={16}>
            {features.map((f) => (
              <Col span={8} key={f.title}>
                <Card
                  size="small"
                  style={{ textAlign: 'center', height: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
                >
                  <div style={{ marginBottom: 12 }}>{f.icon}</div>
                  <Text strong style={{ display: 'block', marginBottom: 6 }}>{f.title}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{f.desc}</Text>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      )}

      {current === 1 && (
        <div>
          <Title level={4} style={{ textAlign: 'center', marginBottom: 28 }}>
            三步快速上手
          </Title>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {steps.map((s, i) => (
              <Card
                key={s.title}
                size="small"
                style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
              >
                <Space size={16} align="start">
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: '#e6f4ff', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, color: '#1677ff', flexShrink: 0,
                  }}>
                    {i + 1}
                  </div>
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>
                      {s.title}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>{s.desc}</Text>
                  </div>
                </Space>
              </Card>
            ))}
          </Space>
        </div>
      )}

      {current === 2 && (
        <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
          <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
          <Title level={4} style={{ marginBottom: 8 }}>准备好了！</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            现在就添加第一台服务器，开始你的部署之旅
          </Paragraph>
        </div>
      )}
    </Modal>
  );
}
