'use client';

import { useEffect } from 'react';
import { App, Modal, Form, Input, Select, Switch, Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { pipelinesApi, serversApi } from '@/lib/api';

const { TextArea } = Input;

interface Props {
  open: boolean;
  initialValues: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PipelineFormModal({ open, initialValues, onClose, onSuccess }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = !!initialValues?.id;

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as { id: string; name: string; ip: string }[]),
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      form.resetFields();
      if (initialValues) {
        form.setFieldsValue({
          ...initialValues,
          buildCommands: Array.isArray(initialValues.buildCommands)
            ? (initialValues.buildCommands as string[]).join('\n')
            : '',
          deployCommands: Array.isArray(initialValues.deployCommands)
            ? (initialValues.deployCommands as string[]).join('\n')
            : '',
        });
      }
    }
  }, [open, initialValues, form]);

  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const payload = {
        ...values,
        buildCommands: String(values.buildCommands ?? '')
          .split('\n')
          .map((s: string) => s.trim())
          .filter(Boolean),
        deployCommands: String(values.deployCommands ?? '')
          .split('\n')
          .map((s: string) => s.trim())
          .filter(Boolean),
      };
      return isEdit
        ? pipelinesApi.update(initialValues!.id as string, payload)
        : pipelinesApi.create(payload);
    },
    onSuccess: () => {
      message.success(isEdit ? '流水线已更新' : '流水线已创建');
      onSuccess();
    },
    onError: () => message.error('操作失败'),
  });

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑流水线' : '新增 CI/CD 流水线'}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mutation.mutate(v as Record<string, unknown>)}
        initialValues={{ branch: 'main', workDir: '/opt/apps', enabled: true }}
      >
        <Form.Item name="name" label="流水线名称" rules={[{ required: true }]}>
          <Input placeholder="如：my-app-deploy" />
        </Form.Item>

        <Form.Item name="repoUrl" label="GitHub 仓库地址" rules={[{ required: true }]}>
          <Input placeholder="https://github.com/owner/repo" />
        </Form.Item>

        <Form.Item name="branch" label="监听分支">
          <Input placeholder="main" />
        </Form.Item>

        <Form.Item
          name="githubToken"
          label={
            <span>
              GitHub Personal Access Token&nbsp;
              <Tooltip title="私有仓库必填，公开仓库可留空">
                <InfoCircleOutlined />
              </Tooltip>
            </span>
          }
        >
          <Input.Password placeholder="ghp_xxxxxxxxxxxx（可选）" />
        </Form.Item>

        <Form.Item name="workDir" label="VPS 工作目录">
          <Input placeholder="/opt/apps" />
        </Form.Item>

        <Form.Item name="serverIds" label="目标服务器" rules={[{ required: true, type: 'array', min: 1 }]}>
          <Select mode="multiple" placeholder="选择目标服务器">
            {servers?.map((s) => (
              <Select.Option key={s.id} value={s.id}>
                {s.name} ({s.ip})
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="buildCommands"
          label={
            <span>
              构建命令&nbsp;
              <Tooltip title="每行一条命令，按顺序执行">
                <InfoCircleOutlined />
              </Tooltip>
            </span>
          }
        >
          <TextArea
            rows={4}
            placeholder={`npm install\nnpm run build`}
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item
          name="deployCommands"
          label={
            <span>
              部署命令&nbsp;
              <Tooltip title="每行一条命令，在构建完成后执行">
                <InfoCircleOutlined />
              </Tooltip>
            </span>
          }
        >
          <TextArea
            rows={3}
            placeholder={`pm2 restart app\nsystemctl restart nginx`}
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
