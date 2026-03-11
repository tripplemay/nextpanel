'use client';

import { useState } from 'react';
import { Space, Select, Button, List, Avatar, Popconfirm, Typography, Spin, Empty } from 'antd';
import { UserOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionsApi, usersApi } from '@/lib/api';
import type { SubscriptionShare } from '@/types/api';

interface Props {
  subscriptionId: string;
}

export default function SubscriptionShareManager({ subscriptionId }: Props) {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>();

  const { data: shares = [], isLoading: sharesLoading } = useQuery({
    queryKey: ['subscription-shares', subscriptionId],
    queryFn: () => subscriptionsApi.listShares(subscriptionId).then((r) => r.data),
  });

  const { data: viewers = [], isLoading: viewersLoading } = useQuery({
    queryKey: ['users-viewers'],
    queryFn: () => usersApi.listViewers().then((r) => r.data),
    staleTime: 0,
  });

  const addMutation = useMutation({
    mutationFn: (userId: string) => subscriptionsApi.addShare(subscriptionId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription-shares', subscriptionId] });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      setSelectedUserId(undefined);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => subscriptionsApi.removeShare(subscriptionId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscription-shares', subscriptionId] });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });

  const sharedUserIds = new Set(shares.map((s: SubscriptionShare) => s.userId));
  const availableViewers = viewers.filter((v) => !sharedUserIds.has(v.id));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Space.Compact style={{ width: '100%' }}>
        <Select
          placeholder="选择 VIEWER 用户"
          style={{ flex: 1 }}
          value={selectedUserId}
          onChange={setSelectedUserId}
          loading={viewersLoading}
          options={availableViewers.map((v) => ({ value: v.id, label: v.username }))}
          notFoundContent={viewersLoading ? <Spin size="small" /> : <span style={{ fontSize: 12 }}>暂无可分享的 VIEWER 用户</span>}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={addMutation.isPending}
          disabled={!selectedUserId}
          onClick={() => selectedUserId && addMutation.mutate(selectedUserId)}
        >
          添加
        </Button>
      </Space.Compact>

      {sharesLoading ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}><Spin size="small" /></div>
      ) : shares.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未分享给任何用户" style={{ padding: '8px 0' }} />
      ) : (
        <List
          size="small"
          dataSource={shares}
          renderItem={(share: SubscriptionShare) => (
            <List.Item
              actions={[
                <Popconfirm
                  key="remove"
                  title="确认取消分享？"
                  okText="确认"
                  cancelText="取消"
                  okType="danger"
                  onConfirm={() => removeMutation.mutate(share.userId)}
                >
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    loading={removeMutation.isPending}
                  >
                    移除
                  </Button>
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                avatar={<Avatar size="small" icon={<UserOutlined />} />}
                title={<Typography.Text>{share.user.username}</Typography.Text>}
              />
            </List.Item>
          )}
        />
      )}
    </Space>
  );
}
