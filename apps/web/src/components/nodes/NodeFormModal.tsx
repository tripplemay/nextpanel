'use client';

import { useEffect, useState } from 'react';
import { App, Modal, Form, Input, Select, InputNumber, Button, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';

const { Option } = Select;

const IMPL_MAP: Record<string, string> = { SHADOWSOCKS: 'SS_LIBEV' };

const SS_METHODS = [
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
];

interface Props {
  open: boolean;
  initialValues: Record<string, unknown> | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function NodeFormModal({ open, initialValues, onClose, onSuccess }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = !!initialValues?.id;

  // These are only used for conditional rendering — no setFieldValue depends on them
  const protocol = Form.useWatch('protocol', form) as string | undefined;
  const transport = Form.useWatch('transport', form) as string | undefined;
  const tls      = Form.useWatch('tls',      form) as string | undefined;

  // serverId kept as plain React state (not form-store-derived) so the name-autofill
  // effect never runs inside a form dispatch cycle → no circular-ref warning
  const [serverId, setServerId] = useState<string | undefined>(undefined);

  const showUuid     = ['VMESS', 'VLESS'].includes(protocol ?? '');
  const showPassword = ['TROJAN', 'SHADOWSOCKS'].includes(protocol ?? '');
  const showMethod   = protocol === 'SHADOWSOCKS';
  const tlsOptions   = transport === 'QUIC' ? ['NONE', 'TLS'] : ['NONE', 'TLS', 'REALITY'];

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as { id: string; name: string }[]),
    enabled: open,
  });

  const { data: serverNodes } = useQuery({
    queryKey: ['nodes', serverId],
    queryFn: () => nodesApi.list(serverId).then((r) => r.data),
    enabled: open && !!serverId,
  });

  const usedPorts = new Set(serverNodes?.map((n) => n.listenPort) ?? []);

  const { data: credentials } = useQuery({
    queryKey: ['node-credentials', initialValues?.id],
    queryFn: () => nodesApi.credentials(initialValues!.id as string).then((r) => r.data),
    enabled: open && isEdit && !!initialValues?.id,
  });

  // Reset form on open/close
  useEffect(() => {
    if (open) {
      form.resetFields();
      if (initialValues) form.setFieldsValue(initialValues);
      setServerId(initialValues?.serverId as string | undefined);
    } else {
      setServerId(undefined);
    }
  }, [open, initialValues, form]);

  // Populate credential fields on edit open
  useEffect(() => {
    if (!credentials || !open) return;
    form.setFieldsValue({
      uuid: credentials.uuid,
      password: credentials.password,
      method: credentials.method,
    });
  }, [credentials, open, form]);

  // Auto-fill node name — split into two effects to guarantee form.setFieldValue
  // is called in a separate render cycle, completely outside the form dispatch chain.

  // Step A: compute the name into plain React state (no form API calls here)
  const [autoName, setAutoName] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (isEdit || !serverId || !servers || serverNodes === undefined) {
      setAutoName(undefined);
      return;
    }
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;

    const escaped = server.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}-(\\d+)$`);
    const usedNumbers = new Set<number>();
    for (const node of serverNodes) {
      const match = node.name.match(pattern);
      if (match) usedNumbers.add(Number(match[1]));
    }
    let n = 1;
    while (usedNumbers.has(n)) n++;
    setAutoName(`${server.name}-${n}`);
  }, [serverId, serverNodes, servers, isEdit]);

  // Step B: apply autoName to the form — runs in a new render cycle after Step A,
  // at which point the form store's subscribing flag is guaranteed to be reset.
  useEffect(() => {
    if (autoName !== undefined) {
      form.setFieldValue('name', autoName);
    }
  }, [autoName, form]);

  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const { uuid, password, method, ...rest } = values;
      const creds: Record<string, string> = {};
      if (uuid)     creds.uuid     = String(uuid);
      if (password) creds.password = String(password);
      if (method)   creds.method   = String(method);
      const payload = { ...(rest as Record<string, unknown>), credentials: creds };
      return isEdit
        ? nodesApi.update(initialValues!.id as string, payload)
        : nodesApi.create(payload as Parameters<typeof nodesApi.create>[0]);
    },
    onSuccess: () => {
      message.success(isEdit ? '节点已更新' : '节点已创建');
      onSuccess();
    },
    onError: () => message.error('操作失败'),
  });

  /**
   * Central change handler for field linkage.
   * All form.setFieldValue calls are deferred via queueMicrotask so they execute
   * after the current rc-field-form dispatch cycle fully completes, eliminating
   * the "circular references" warning.
   */
  function handleValuesChange(changed: Record<string, unknown>) {
    // Plain state update — no form API involved, always safe
    if ('serverId' in changed) {
      setServerId(changed.serverId as string | undefined);
    }

    // Deferred form-value updates
    queueMicrotask(() => {
      if ('protocol' in changed) {
        form.setFieldValue('implementation', IMPL_MAP[changed.protocol as string] ?? 'XRAY');
      }
      if ('transport' in changed && changed.transport === 'QUIC') {
        if (form.getFieldValue('tls') === 'REALITY') {
          form.setFieldValue('tls', 'NONE');
        }
      }
    });
  }

  function generateUuid() {
    form.setFieldValue('uuid', crypto.randomUUID());
  }

  function generatePort() {
    const MIN = 10000, MAX = 60000;
    let port: number;
    let attempts = 0;
    do {
      port = Math.floor(Math.random() * (MAX - MIN + 1)) + MIN;
      attempts++;
    } while (usedPorts.has(port) && attempts < 200);
    form.setFieldValue('listenPort', port);
  }

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑节点' : '新增节点'}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mutation.mutate(v as Record<string, unknown>)}
        onValuesChange={handleValuesChange}
        initialValues={{ tls: 'NONE', implementation: 'XRAY', transport: 'TCP' }}
      >
        <Form.Item name="serverId" label="服务器" rules={[{ required: true }]}>
          <Select placeholder="选择服务器">
            {servers?.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item name="name" label="节点名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>

        <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
          <Select>
            {['VMESS', 'VLESS', 'TROJAN', 'SHADOWSOCKS', 'SOCKS5', 'HTTP'].map((p) => (
              <Option key={p} value={p}>{p}</Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="implementation" label="实现">
          <Select allowClear>
            {['XRAY', 'V2RAY', 'SING_BOX', 'SS_LIBEV'].map((i) => (
              <Option key={i} value={i}>{i}</Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="transport" label="传输">
          <Select allowClear>
            {['TCP', 'WS', 'GRPC', 'QUIC'].map((t) => <Option key={t} value={t}>{t}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item name="tls" label="TLS">
          <Select>
            {tlsOptions.map((t) => <Option key={t} value={t}>{t}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item label="监听端口" required>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="listenPort" rules={[{ required: true }]} noStyle>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Button onClick={generatePort}>生成</Button>
          </Space.Compact>
        </Form.Item>

        <Form.Item name="domain" label="域名">
          <Input placeholder="可选" />
        </Form.Item>

        {showUuid && (
          <Form.Item label="UUID">
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="uuid" noStyle>
                <Input placeholder="留空自动生成" />
              </Form.Item>
              <Button onClick={generateUuid}>生成</Button>
            </Space.Compact>
          </Form.Item>
        )}

        {showPassword && (
          <Form.Item name="password" label="密码">
            <Input.Password />
          </Form.Item>
        )}

        {isEdit && tls === 'REALITY' && credentials?.realityPublicKey && (
          <Form.Item label="REALITY 公钥（客户端填此值）">
            <Space.Compact style={{ width: '100%' }}>
              <Input value={credentials.realityPublicKey} readOnly />
              <Button onClick={() => navigator.clipboard.writeText(credentials!.realityPublicKey!)}>
                复制
              </Button>
            </Space.Compact>
          </Form.Item>
        )}

        {showMethod && (
          <Form.Item name="method" label="加密方式">
            <Select
              showSearch
              placeholder="选择加密方式"
              options={SS_METHODS.map((m) => ({ label: m, value: m }))}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
