'use client';

import { useMemo, useState } from 'react';
import { Button, Card, Collapse, Empty, Spin, Table, Tag, Typography } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { recommendsApi } from '@/lib/api';
import { useIsMobile } from '@/hooks/useIsMobile';
import PageHeader from '@/components/common/PageHeader';
import type { ServerRecommend, ServerRecommendCategory } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

export default function RecommendsPage() {
  const { isMobile } = useIsMobile();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['recommends'],
    queryFn: () => recommendsApi.list().then((r) => r.data),
  });

  // Filter out empty categories
  const nonEmptyCategories = useMemo(
    () => categories.filter((cat) => cat.recommends.length > 0),
    [categories],
  );

  // Track collapsed IDs (all expanded by default)
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);

  const activeKeys = useMemo(
    () => nonEmptyCategories.map((c) => c.id).filter((id) => !collapsedIds.includes(id)),
    [nonEmptyCategories, collapsedIds],
  );

  const columns: ColumnType<ServerRecommend>[] = useMemo(() => {
    const cols: ColumnType<ServerRecommend>[] = [
      { title: '名称', dataIndex: 'name', ellipsis: true },
      { title: '价格', dataIndex: 'price', width: 140 },
    ];

    if (!isMobile) {
      cols.push({
        title: '地区',
        dataIndex: 'regions',
        render: (regions: string[]) =>
          regions?.map((r) => (
            <Tag key={r} color="blue" style={{ marginBottom: 2 }}>
              {r}
            </Tag>
          )),
      });
    }

    cols.push({
      title: '操作',
      width: 80,
      render: (_: unknown, record: ServerRecommend) => (
        <Button
          type="link"
          size="small"
          icon={<LinkOutlined />}
          href={record.link}
          target="_blank"
          rel="noopener noreferrer"
        >
          购买
        </Button>
      ),
    });

    return cols;
  }, [isMobile]);

  const collapseItems = nonEmptyCategories.map((cat) => {
    const recommends = cat.recommends.map((r) => r.recommend);
    return {
      key: cat.id,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 500 }}>{cat.name}</span>
          {cat.description && !isMobile && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{cat.description}</Typography.Text>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{recommends.length} 个推荐</Typography.Text>
        </div>
      ),
      children: (
        <Table
          rowKey="id"
          size="middle"
          dataSource={recommends}
          columns={columns}
          pagination={recommends.length > 10 ? { showTotal: (total) => `共 ${total} 条` } : false}
        />
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
