'use client';

import { useMemo, useState } from 'react';
import { Button, Card, Col, Collapse, Empty, Row, Spin, Tag, Typography } from 'antd';
import {
  LinkOutlined,
  ThunderboltOutlined,
  PlayCircleOutlined,
  DollarOutlined,
  SafetyOutlined,
  GlobalOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { recommendsApi } from '@/lib/api';
import { useIsMobile } from '@/hooks/useIsMobile';
import PageHeader from '@/components/common/PageHeader';
import type { ServerRecommend, ServerRecommendCategory } from '@/types/api';

const CATEGORY_THEMES: Record<string, { color: string; icon: React.ReactNode }> = {
  'AI': { color: '#722ed1', icon: <ThunderboltOutlined /> },
  'ai': { color: '#722ed1', icon: <ThunderboltOutlined /> },
  'AI友好': { color: '#722ed1', icon: <ThunderboltOutlined /> },
  'AI 友好': { color: '#722ed1', icon: <ThunderboltOutlined /> },
  '流媒体': { color: '#1677ff', icon: <PlayCircleOutlined /> },
  '流媒体友好': { color: '#1677ff', icon: <PlayCircleOutlined /> },
  '高性价比': { color: '#52c41a', icon: <DollarOutlined /> },
  '性价比': { color: '#52c41a', icon: <DollarOutlined /> },
  '安全': { color: '#fa8c16', icon: <SafetyOutlined /> },
  '稳定': { color: '#fa8c16', icon: <SafetyOutlined /> },
};

const DEFAULT_THEME = { color: '#1677ff', icon: <GlobalOutlined /> };

const THEME_COLORS = ['#722ed1', '#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#13c2c2'];

function getCategoryIcon(name: string): React.ReactNode {
  if (CATEGORY_THEMES[name]) return CATEGORY_THEMES[name].icon;
  for (const [key, theme] of Object.entries(CATEGORY_THEMES)) {
    if (name.includes(key)) return theme.icon;
  }
  return <StarOutlined />;
}

function getCategoryTheme(name: string, index: number, color?: string | null) {
  const icon = getCategoryIcon(name);
  if (color) return { color, icon };
  // Try exact match first, then keyword match
  if (CATEGORY_THEMES[name]) return CATEGORY_THEMES[name];
  for (const [key, theme] of Object.entries(CATEGORY_THEMES)) {
    if (name.includes(key)) return theme;
  }
  // Fallback: cycle through colors
  return { color: THEME_COLORS[index % THEME_COLORS.length], icon };
}

export default function RecommendsPage() {
  const { isMobile } = useIsMobile();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['recommends'],
    queryFn: () => recommendsApi.list().then((r) => r.data),
  });

  const nonEmptyCategories = useMemo(
    () => categories.filter((cat) => cat.recommends.length > 0),
    [categories],
  );

  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);

  const activeKeys = useMemo(
    () => nonEmptyCategories.map((c) => c.id).filter((id) => !collapsedIds.includes(id)),
    [nonEmptyCategories, collapsedIds],
  );

  const collapseItems = nonEmptyCategories.map((cat, index) => {
    const recommends = cat.recommends.map((r) => r.recommend).sort((a, b) => {
      if (cat.featuredId === a.id) return -1;
      if (cat.featuredId === b.id) return 1;
      return 0;
    });
    const theme = getCategoryTheme(cat.name, index, cat.color);

    return {
      key: cat.id,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              background: theme.color,
              color: '#fff',
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {theme.icon}
          </span>
          <span style={{ fontWeight: 500, fontSize: 15 }}>{cat.name}</span>
          {cat.description && !isMobile && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{cat.description}</Typography.Text>
          )}
          <Tag style={{ margin: 0, marginLeft: 'auto', flexShrink: 0 }}>{recommends.length} 个推荐</Tag>
        </div>
      ),
      children: (
        <Row gutter={[16, 16]} style={{ padding: '4px 0' }}>
          {recommends.map((rec) => (
            <Col key={rec.id} xs={24} sm={12} lg={8} xl={6}>
              <Card
                size="small"
                hoverable
                style={{
                  height: '100%',
                  borderRadius: 10,
                  borderTop: `3px solid ${theme.color}`,
                }}
                styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%', padding: '16px' } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  {(() => {
                    try {
                      const hostname = new URL(rec.link).hostname;
                      return (
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                          alt=""
                          width={20}
                          height={20}
                          style={{ borderRadius: 4, flexShrink: 0 }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      );
                    } catch {
                      return null;
                    }
                  })()}
                  <Typography.Text strong style={{ fontSize: 15 }}>{rec.name}</Typography.Text>
                  {cat.featuredId === rec.id && <Tag color="red" style={{ margin: 0 }}>推荐</Tag>}
                </div>

                <Typography.Text
                  style={{
                    display: 'block',
                    marginBottom: 10,
                    color: theme.color,
                    fontWeight: 600,
                    fontSize: 16,
                  }}
                >
                  {rec.price}
                </Typography.Text>

                <div style={{ marginBottom: 12, flex: 1 }}>
                  {rec.regions.map((region) => (
                    <Tag key={region} style={{ marginBottom: 4 }}>
                      {region}
                    </Tag>
                  ))}
                </div>

                <Button
                  type="primary"
                  icon={<LinkOutlined />}
                  href={rec.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  block
                  style={{ background: theme.color, borderColor: theme.color }}
                >
                  购买
                </Button>
              </Card>
            </Col>
          ))}
        </Row>
      ),
    };
  });

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="服务器推荐" />

      <Spin spinning={isLoading}>
        {!isLoading && nonEmptyCategories.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无推荐" style={{ padding: '32px 0' }} />
        ) : (
          <Collapse
            activeKey={activeKeys}
            onChange={(keys) => {
              const activeSet = new Set(Array.isArray(keys) ? keys : [keys]);
              setCollapsedIds(nonEmptyCategories.map((c) => c.id).filter((id) => !activeSet.has(id)));
            }}
            items={collapseItems}
            style={{ background: 'transparent' }}
          />
        )}
      </Spin>
    </Card>
  );
}
