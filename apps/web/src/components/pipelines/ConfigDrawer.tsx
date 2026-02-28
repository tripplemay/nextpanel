'use client';

import { Drawer, Space, Typography, Steps, Input, Alert, Divider } from 'antd';
import { GithubOutlined, CodeOutlined, KeyOutlined } from '@ant-design/icons';
import CopyButton from '@/components/common/CopyButton';
import type { GithubConfig } from '@/types/api';

const { Text, Paragraph } = Typography;

interface ConfigDrawerProps {
  open: boolean;
  pipelineName: string | null;
  pipelineBranch?: string;
  config: GithubConfig | null;
  loading: boolean;
  onClose: () => void;
}

export default function ConfigDrawer({
  open,
  pipelineName,
  pipelineBranch,
  config,
  loading,
  onClose,
}: ConfigDrawerProps) {
  return (
    <Drawer
      open={open}
      title={
        <Space>
          <GithubOutlined />
          <span>GitHub Actions 配置 — {pipelineName}</span>
        </Space>
      }
      width={720}
      onClose={onClose}
      loading={loading}
    >
      {config && (
        <>
          <Steps
            size="small"
            style={{ marginBottom: 24 }}
            items={[
              { title: '获取 Workflow 文件', status: 'finish', icon: <CodeOutlined /> },
              { title: '配置 GitHub Secrets', status: 'finish', icon: <KeyOutlined /> },
              { title: 'Push 代码触发部署', status: 'finish', icon: <GithubOutlined /> },
            ]}
          />

          {/* Step 1: Workflow YAML */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong>
                Step 1：将以下文件保存为 <Text code>.github/workflows/deploy.yml</Text>
              </Text>
              <CopyButton text={config.yaml} />
            </div>
            <pre
              style={{
                background: '#0d1117',
                color: '#c9d1d9',
                fontFamily: 'monospace',
                fontSize: 12,
                padding: 16,
                borderRadius: 6,
                overflowX: 'auto',
                maxHeight: 360,
                overflowY: 'auto',
                margin: 0,
                lineHeight: 1.6,
              }}
            >
              {config.yaml}
            </pre>
          </div>

          <Divider />

          {/* Step 2: Secrets */}
          <div>
            <Paragraph strong style={{ marginBottom: 12 }}>
              Step 2：在 GitHub 仓库{' '}
              <Text code>Settings → Secrets and variables → Actions → New repository secret</Text>{' '}
              中添加以下变量：
            </Paragraph>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {config.secrets.map((secret) => (
                <div
                  key={secret.name}
                  style={{
                    border: '1px solid #f0f0f0',
                    borderRadius: 8,
                    padding: '10px 14px',
                    background: '#fafafa',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Space>
                      <Text code strong style={{ fontSize: 13 }}>
                        {secret.name}
                      </Text>
                      {secret.description && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {secret.description}
                        </Text>
                      )}
                    </Space>
                    <CopyButton text={secret.value} />
                  </div>
                  <Input.Password
                    readOnly
                    value={secret.value}
                    size="small"
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  />
                </div>
              ))}
            </div>
          </div>

          <Divider />

          <Alert
            type="success"
            showIcon
            message="Step 3：推送代码自动部署"
            description={
              <>
                完成以上配置后，向 <Text code>{pipelineBranch}</Text> 分支推送代码，GitHub Actions 将自动触发部署流程。
                也可在 GitHub 仓库的 <Text code>Actions</Text> 标签页手动触发（workflow_dispatch）。
              </>
            }
          />
        </>
      )}
    </Drawer>
  );
}
