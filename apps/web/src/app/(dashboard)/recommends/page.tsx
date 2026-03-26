'use client';

import { Button, Card, Col, Empty, Row, Spin, Tag, Typography } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { recommendsApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';

const { Title, Text } = Typography;

export default function RecommendsPage() {
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['recommends'],
    queryFn: () => recommendsApi.list().then((r) => r.data),
  });

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="服务器推荐" />

      <Spin spinning={isLoading}>
        {!isLoading && categories.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无推荐" style={{ padding: '32px 0' }} />
        ) : (
          categories.map((cat) => (
            <div key={cat.id} style={{ marginBottom: 32 }}>
              <Title level={5} style={{ marginBottom: 4 }}>{cat.name}</Title>
              {cat.description && (
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>{cat.description}</Text>
              )}
              {cat.recommends.length === 0 ? (
                <Text type="secondary">该分类暂无推荐</Text>
              ) : (
                <Row gutter={[16, 16]}>
                  {cat.recommends.map((rec) => (
                    <Col key={rec.id} xs={24} sm={12} lg={8}>
                      <Card
                        size="small"
                        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', height: '100%' }}
                        actions={[
                          <Button
                            key="buy"
                            type="link"
                            icon={<LinkOutlined />}
                            href={rec.link}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            购买
                          </Button>,
                        ]}
                      >
                        <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 8 }}>
                          {rec.name}
                        </Text>
                        <Text style={{ display: 'block', marginBottom: 8, color: '#fa541c', fontWeight: 500 }}>
                          {rec.price}
                        </Text>
                        <div>
                          {rec.regions.map((region) => (
                            <Tag key={region} color="blue" style={{ marginBottom: 4 }}>
                              {region}
                            </Tag>
                          ))}
                        </div>
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}
            </div>
          ))
        )}
      </Spin>
    </Card>
  );
}
