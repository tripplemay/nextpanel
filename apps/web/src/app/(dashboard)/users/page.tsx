'use client';

import { useState } from 'react';
import { App, Card, Table, Tag, Select, Popconfirm, Button, Space } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { UserRecord } from '@/types/api';
import PageHeader from '@/components/common/PageHeader';
import { useIsMobile } from '@/hooks/useIsMobile';

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'red',
  OPERATOR: 'blue',
  VIEWER: 'default',
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理员',
  OPERATOR: '普通',
  VIEWER: '订阅',
};

export default function UsersPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { isMobile } = useIsMobile();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchRole, setBatchRole] = useState<string | undefined>();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      usersApi.updateRole(id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('角色已更新');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(msg ?? '更新失败');
    },
  });

  async function handleBatchUpdate() {
    if (!batchRole || selectedIds.length === 0) return;
    await Promise.all(selectedIds.map((id) => usersApi.updateRole(id, batchRole)));
    queryClient.invalidateQueries({ queryKey: ['users'] });
    message.success(`已将 ${selectedIds.length} 个用户角色更新为「${ROLE_LABELS[batchRole]}」`);
    setSelectedIds([]);
    setBatchRole(undefined);
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      message.success('用户已删除');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(msg ?? '删除失败');
    },
  });

  const allUserColumns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string, record: UserRecord) => {
        const isSelf = record.id === currentUser?.id;
        const isAdmin = role === 'ADMIN';
        if (isSelf || isAdmin) {
          return <Tag color={ROLE_COLORS[role]}>{ROLE_LABELS[role]}</Tag>;
        }
        return (
          <Select
            value={role}
            size="small"
            style={{ width: 90 }}
            onChange={(newRole) => updateRoleMutation.mutate({ id: record.id, role: newRole })}
            options={[
              { value: 'OPERATOR', label: '普通' },
              { value: 'VIEWER', label: '订阅' },
            ]}
          />
        );
      },
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, record: UserRecord) => {
        const isSelf = record.id === currentUser?.id;
        const isAdmin = record.role === 'ADMIN';
        if (isSelf || isAdmin) return null;
        return (
          <Popconfirm
            title="确认删除该用户？"
            description="删除后无法恢复，该用户的所有数据将保留但账号不可登录。"
            onConfirm={() => deleteMutation.mutate(record.id)}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        );
      },
    },
  ];
  const columns = isMobile
    ? allUserColumns.filter((c) => c.key !== 'createdAt')
    : allUserColumns;

  // Users eligible for selection: non-self, non-admin
  const selectableIds = new Set(
    users.filter((u) => u.id !== currentUser?.id && u.role !== 'ADMIN').map((u) => u.id),
  );

  return (
    <>
      <PageHeader title="用户管理" />
      <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        {selectedIds.length > 0 && (
          <Space style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: '#595959' }}>已选 {selectedIds.length} 人，批量设置角色：</span>
            <Select
              value={batchRole}
              placeholder="选择角色"
              style={{ width: 100 }}
              onChange={setBatchRole}
              options={[
                { value: 'OPERATOR', label: '普通' },
                { value: 'VIEWER', label: '订阅' },
              ]}
            />
            <Button type="primary" disabled={!batchRole} onClick={handleBatchUpdate}>
              确认修改
            </Button>
            <Button onClick={() => { setSelectedIds([]); setBatchRole(undefined); }}>取消</Button>
          </Space>
        )}
        <Table
          size="middle"
          rowKey="id"
          loading={isLoading}
          dataSource={users}
          columns={columns}
          scroll={{ x: 'max-content' }}
          pagination={{ showTotal: (total) => `共 ${total} 条` }}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as string[]),
            getCheckboxProps: (record: UserRecord) => ({
              disabled: !selectableIds.has(record.id),
            }),
          }}
        />
      </Card>
    </>
  );
}
