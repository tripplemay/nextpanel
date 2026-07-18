'use client';

import { Card, Col, Row, Skeleton } from 'antd';

/** 表格页骨架屏 */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card styles={{ body: { padding: '16px 24px' } }}>
      <Skeleton.Button active block size="small" style={{ height: 32, marginBottom: 20 }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ marginBottom: 16 }}>
          <Skeleton active title={false} paragraph={{ rows: 1, width: '100%' }} />
        </div>
      ))}
    </Card>
  );
}

/** 卡片网格骨架屏（栅格与服务器卡片视图一致） */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <Row gutter={[16, 16]}>
      {Array.from({ length: count }).map((_, i) => (
        <Col xs={24} sm={12} lg={8} xl={6} key={i}>
          <Card>
            <Skeleton active paragraph={{ rows: 3 }} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

/** 详情页骨架屏 */
export function DetailSkeleton() {
  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Skeleton active avatar paragraph={{ rows: 2 }} />
      </Card>
      <Card>
        <Skeleton active paragraph={{ rows: 6 }} />
      </Card>
    </div>
  );
}
