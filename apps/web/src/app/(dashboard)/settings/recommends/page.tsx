'use client';

import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { recommendsApi } from '@/lib/api';
import PageHeader from '@/components/common/PageHeader';
import type { ServerRecommendCategory, ServerRecommend } from '@/types/api';

const { Title } = Typography;

export default function RecommendsManagePage() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<ServerRecommendCategory | null>(null);
  const [catForm] = Form.useForm();

  const [recModalOpen, setRecModalOpen] = useState(false);
  const [editingRec, setEditingRec] = useState<ServerRecommend | null>(null);
  const [recForm] = Form.useForm();
  const [extracting, setExtracting] = useState(false);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['recommends'],
    queryFn: () => recommendsApi.list().then((r) => r.data),
  });

  // Flatten recommends for table
  const allRecommends = categories.flatMap((cat) =>
    cat.recommends.map((rec) => ({ ...rec, categoryName: cat.name })),
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
    mutationFn: (data: { categoryId: string; name: string; price: string; regions: string[]; link: string; sortOrder?: number }) =>
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
    mutationFn: ({ id, data }: { id: string; data: { name?: string; price?: string; regions?: string[]; link?: string; sortOrder?: number } }) =>
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
      categoryId: rec.categoryId,
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

  // ── Category table columns ──
  const catColumns = [
    { title: '名称', dataIndex: 'name' },
    { title: '描述', dataIndex: 'description', render: (v: string | null) => v || '-' },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, record: ServerRecommendCategory) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditCat(record)} />
          <Popconfirm
            title="确认删除该分类？"
            description="删除分类会同时删除其下所有服务商推荐。"
            onConfirm={() => removeCatMutation.mutate(record.id)}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Recommend table columns ──
  const recColumns = [
    { title: '名称', dataIndex: 'name' },
    { title: '分类', dataIndex: 'categoryName' },
    { title: '价格', dataIndex: 'price' },
    {
      title: '地区',
      dataIndex: 'regions',
      render: (regions: string[]) =>
        regions?.map((r) => (
          <Tag key={r} color="blue" style={{ marginBottom: 2 }}>
            {r}
          </Tag>
        )),
    },
    {
      title: '链接',
      dataIndex: 'link',
      ellipsis: true,
      render: (v: string) => (
        <a href={v} target="_blank" rel="noopener noreferrer">
          {v}
        </a>
      ),
    },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, record: ServerRecommend & { categoryName: string }) => (
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
    },
  ];

  return (
    <Card style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <PageHeader title="服务器推荐管理" />

      {/* ── Category section ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0 }}>分类管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddCat}>
          新增分类
        </Button>
      </div>

      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={categories}
        columns={catColumns}
        pagination={{ showTotal: (total) => `共 ${total} 条` }}
      />

      <Divider />

      {/* ── Recommend section ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Title level={5} style={{ margin: 0 }}>服务商管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAddRec}>
          新增服务商
        </Button>
      </div>

      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={allRecommends}
        columns={recColumns}
        scroll={{ x: 'max-content' }}
        pagination={{ showTotal: (total) => `共 ${total} 条` }}
      />

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
          <Form.Item name="categoryId" label="分类" rules={[{ required: true, message: '请选择分类' }]}>
            <Select placeholder="选择分类">
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
