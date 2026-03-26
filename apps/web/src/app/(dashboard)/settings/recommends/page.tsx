'use client';

import { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Collapse,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendsApi } from '@/lib/api';
import { useIsMobile } from '@/hooks/useIsMobile';
import PageHeader from '@/components/common/PageHeader';
import type { ServerRecommendCategory, ServerRecommend } from '@/types/api';
import type { ColumnType } from 'antd/es/table';

export default function RecommendsManagePage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { isMobile } = useIsMobile();

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<ServerRecommendCategory | null>(null);
  const [catForm] = Form.useForm();

  const [recModalOpen, setRecModalOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<ServerRecommend | null>(null);
  const [recForm] = Form.useForm();
  const [extracting, setExtracting] = useState(false);

  // Track collapsed IDs (all expanded by default)
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['recommends'],
    queryFn: () => recommendsApi.list().then((r) => r.data),
  });

  const activeKeys = useMemo(
    () => categories.map((c) => c.id).filter((id) => !collapsedIds.includes(id)),
    [categories, collapsedIds],
  );

  // ── Category mutations ──
  const createCatMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; sortOrder?: number }) =>
      recommendsApi.createCategory(data),
    onSuccess: () => {
      message.success('分类已创建');
      qc.invalidateQueries({ queryKey: ['recommends'] });
      setCatModalOpen(false);
      catForm.resetFields();
    },
    onError: () => message.error('创建失败'),
  });

  const updateCatMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string; sortOrder?: number } }) =>
      recommendsApi.updateCategory(id, data),
    onSuccess: () => {
      message.success('分类已更新');
      qc.invalidateQueries({ queryKey: ['recommends'] });
      setCatModalOpen(false);
      setEditingCat(null);
      catForm.resetFields();
    },
    onError: () => message.error('更新失败'),
  });

  const removeCatMutation = useMutation({
    mutationFn: (id: string) => recommendsApi.removeCategory(id),
    onSuccess: () => {
      message.success('分类已删除');
      qc.invalidateQueries({ queryKey: ['recommends'] });
    },
    onError: () => message.error('删除失败'),
  });

  // ── Recommend mutations ──
  const createRecMutation = useMutation({
    mutationFn: (data: { categoryIds: string[]; name: string; price: string; regions: string[]; link: string; sortOrder?: number }) =>
      recommendsApi.create(data),
    onSuccess: () => {
      message.success('服务商已创建');
      qc.invalidateQueries({ queryKey: ['recommends'] });
      setRecModalOpen(false);
      recForm.resetFields();
    },
    onError: () => message.error('创建失败'),
  });

  const updateRecMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; price?: string; regions?: string[]; link?: string; categoryIds?: string[]; sortOrder?: number } }) =>
      recommendsApi.update(id, data),
    onSuccess: () => {
      message.success('服务商已更新');
      qc.invalidateQueries({ queryKey: ['recommends'] });
      setRecModalOpen(false);
      setEditingRec(null);
      recForm.resetFields();
    },
    onError: () => message.error('更新失败'),
  });

  const removeRecMutation = useMutation({
    mutationFn: (id: string) => recommendsApi.remove(id),
    onSuccess: () => {
      message.success('服务商已删除');
      qc.invalidateQueries({ queryKey: ['recommends'] });
    },
    onError: () => message.error('删除失败'),
  });

  // ── Extract ──
  async function handleExtract() {
    const url = recForm.getFieldValue('link');
    if (!url) {
      message.warning('请先输入链接');
      return;
    }
    setExtracting(true);
    try {
      const res = await recommendsApi.extract(url);
      const result = res.data;
      recForm.setFieldsValue({
        name: result.name,
        price: result.price,
        regions: result.regions,
      });
      message.success('识别成功');
    } catch {
      message.error('自动识别失败，请手动填写');
    } finally {
      setExtracting(false);
    }
  }

  // ── Category handlers ──
  function openAddCat() {
    setEditingCat(null);
    catForm.resetFields();
    setCatModalOpen(true);
  }

  function openEditCat(cat: ServerRecommendCategory) {
    setEditingCat(cat);
    catForm.setFieldsValue({ name: cat.name, description: cat.description ?? '', sortOrder: cat.sortOrder });
    setCatModalOpen(true);
  }

  function handleCatOk() {
    catForm.validateFields().then((values) => {
      if (editingCat) {
        updateCatMutation.mutate({ id: editingCat.id, data: values });
      } else {
        createCatMutation.mutate(values);
      }
    });
  }

  // ── Recommend handlers ──
  function openAddRec() {
    setEditingRec(null);
    recForm.resetFields();
    setRecModalOpen(true);
  }

  function openEditRec(rec: ServerRecommend) {
    setEditingRec(rec);
    recForm.setFieldsValue({
      categoryIds: rec.categories?.map((c) => c.category.id) ?? [],
      name: rec.name,
      price: rec.price,
      regions: rec.regions,
      link: rec.link,
      sortOrder: rec.sortOrder,
    });
    setRecModalOpen(true);
  }

  function handleRecOk() {
    recForm.validateFields().then((values) => {
      if (editingRec) {
        updateRecMutation.mutate({ id: editingRec.id, data: values });
      } else {
        createRecMutation.mutate(values);
      }
    });
  }

  // ── Recommend table columns ──
  const recColumns: ColumnType<ServerRecommend>[] = useMemo(() => {
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
      cols.push({
        title: '链接',
        dataIndex: 'link',
        ellipsis: true,
        render: (v: string) => (
          <a href={v} target="_blank" rel="noopener noreferrer">
            {v}
          </a>
        ),
      });
      cols.push({ title: '排序', dataIndex: 'sortOrder', width: 80 });
    }

    cols.push({
      title: '操作',
      width: 100,
      render: (_: unknown, record: ServerRecommend) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditRec(record)} />
          <Popconfirm
            title="确认删除该服务商？"
            onConfirm={() => removeRecMutation.mutate(record.id)}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    });

    return cols;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const collapseItems = categories.map((cat) => {
    const recommends = cat.recommends.map((r) => r.recommend);
    return {
      key: cat.id,
      label: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 500 }}>{cat.name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {recommends.length} 个服务商
          </Typography.Text>
          <div style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <Space size={4}>
              <Button size="small" icon={<EditOutlined />} onClick={() => openEditCat(cat)} />
              <Popconfirm
                title="确认删除该分类？"
                description="删除分类会同时删除其下所有服务商推荐。"
                onConfirm={() => removeCatMutation.mutate(cat.id)}
                okText="删除"
                okType="danger"
                cancelText="取消"
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </div>
        </div>
      ),
      children: recommends.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该分类暂无服务商" style={{ padding: '16px 0' }} />
      ) : (
        <Table
          rowKey="id"
          size="middle"
          dataSource={recommends}
          columns={recColumns}
          scroll={isMobile ? undefined : { x: 'max-content' }}
          pagination={recommends.length > 10 ? { showTotal: (total) => `共 ${total} 条` } : false}
        />
      ),
    };
  });

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="服务器推荐管理" />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <Button icon={<PlusOutlined />} onClick={openAddCat}>
          新增分类
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddRec}>
          新增服务商
        </Button>
      </div>

      <Spin spinning={isLoading}>
        {!isLoading && categories.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分类" style={{ padding: '32px 0' }} />
        ) : (
          <Collapse
            activeKey={activeKeys}
            onChange={(keys) => {
              const activeSet = new Set(Array.isArray(keys) ? keys : [keys]);
              setCollapsedIds(categories.map((c) => c.id).filter((id) => !activeSet.has(id)));
            }}
            items={collapseItems}
            style={{ background: 'transparent' }}
          />
        )}
      </Spin>

      {/* ── Category Modal ── */}
      <Modal
        open={catModalOpen}
        title={editingCat ? '编辑分类' : '新增分类'}
        onCancel={() => { setCatModalOpen(false); setEditingCat(null); catForm.resetFields(); }}
        onOk={handleCatOk}
        confirmLoading={createCatMutation.isPending || updateCatMutation.isPending}
        okText="确定"
        cancelText="取消"
      >
        <Form form={catForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入分类名称' }]}>
            <Input placeholder="例如：高性价比 VPS" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="分类描述（可选）" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="数字越小越靠前" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Recommend Modal ── */}
      <Modal
        open={recModalOpen}
        title={editingRec ? '编辑服务商' : '新增服务商'}
        onCancel={() => { setRecModalOpen(false); setEditingRec(null); recForm.resetFields(); }}
        onOk={handleRecOk}
        confirmLoading={createRecMutation.isPending || updateRecMutation.isPending}
        okText="确定"
        cancelText="取消"
        width={560}
      >
        <Form form={recForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="链接" name="link" rules={[{ required: true, message: '请输入链接' }]}>
            <Space.Compact style={{ width: '100%' }}>
              <Input placeholder="https://example.com/aff/xxx" style={{ flex: 1 }} />
              <Button icon={<SearchOutlined />} loading={extracting} onClick={handleExtract}>
                自动识别
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="categoryIds" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
            <Select mode="multiple" placeholder="选择分类（可多选）">
              {categories.map((cat) => (
                <Select.Option key={cat.id} value={cat.id}>
                  {cat.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入服务商名称' }]}>
            <Input placeholder="例如：RackNerd" />
          </Form.Item>
          <Form.Item name="price" label="价格" rules={[{ required: true, message: '请输入价格' }]}>
            <Input placeholder="例如：$11.88/年" />
          </Form.Item>
          <Form.Item name="regions" label="地区" rules={[{ required: true, message: '请选择或输入地区' }]}>
            <Select mode="tags" placeholder="输入地区后回车，如：美国、日本" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} placeholder="数字越小越靠前" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
