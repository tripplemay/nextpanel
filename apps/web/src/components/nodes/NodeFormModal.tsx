'use client';

import { useEffect, useState } from 'react';
import {
  App,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Space,
  Switch,
  Divider,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';
import type { AxiosError } from 'axios';

const { Option } = Select;

// Protocol → default implementation mapping
const IMPL_MAP: Record<string, string> = { SHADOWSOCKS: 'SS_LIBEV' };

// Protocol → valid implementations
const IMPL_OPTIONS: Record<string, string[]> = {
  VMESS:       ['XRAY', 'V2RAY', 'SING_BOX'],
  VLESS:       ['XRAY', 'SING_BOX'],
  TROJAN:      ['XRAY', 'SING_BOX'],
  SHADOWSOCKS: ['SS_LIBEV', 'SING_BOX'],
  SOCKS5:      ['XRAY', 'SING_BOX'],
  HTTP:        ['XRAY', 'SING_BOX'],
};

const ALL_IMPLS = ['XRAY', 'V2RAY', 'SING_BOX', 'SS_LIBEV'];

const SS_METHODS = [
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function randomPassword(length = 20): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map((b) => chars[b % chars.length]).join('');
}

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

  // Watched values for conditional rendering — no setFieldValue calls depend on these
  const protocol  = Form.useWatch('protocol',  form) as string | undefined;
  const transport = Form.useWatch('transport', form) as string | undefined;
  const tls       = Form.useWatch('tls',       form) as string | undefined;

  // serverId kept as plain React state to avoid circular-ref warnings on name-autofill
  const [serverId, setServerId] = useState<string | undefined>(undefined);

  // Derived display flags
  const showUuid     = ['VMESS', 'VLESS'].includes(protocol ?? '');
  const showPassword = ['TROJAN', 'SHADOWSOCKS', 'SOCKS5', 'HTTP'].includes(protocol ?? '');
  const showUsername = ['SOCKS5', 'HTTP'].includes(protocol ?? '');
  const showMethod   = protocol === 'SHADOWSOCKS';
  const isReality    = tls === 'REALITY';
  const showCreds    = showUuid || showUsername || showPassword;
  const passwordRequired = ['TROJAN', 'SHADOWSOCKS'].includes(protocol ?? '');

  const realityAllowed = ['VLESS', 'TROJAN'].includes(protocol ?? '');
  const tlsOptions = realityAllowed ? ['NONE', 'TLS', 'REALITY'] : ['NONE', 'TLS'];
  const implOptions = protocol ? (IMPL_OPTIONS[protocol] ?? ALL_IMPLS) : ALL_IMPLS;
  const domainLabel = isReality ? '伪装域名（SNI）' : '域名';

  // ── Data fetching ──────────────────────────────────────────────────────────

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

  // ── Effects ────────────────────────────────────────────────────────────────

  // Reset / populate form on open
  useEffect(() => {
    if (open) {
      form.resetFields();
      if (initialValues) form.setFieldsValue(initialValues);
      setServerId(initialValues?.serverId as string | undefined);
    } else {
      setServerId(undefined);
    }
  }, [open, initialValues, form]);

  // Populate credential fields when editing
  useEffect(() => {
    if (!credentials || !open) return;
    form.setFieldsValue({
      uuid:     credentials.uuid,
      password: credentials.password,
      method:   credentials.method,
      username: credentials.username,
    });
  }, [credentials, open, form]);

  // Step A: compute suggested node name into plain React state (no form API)
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

  // Step B: apply autoName using setFieldsValue (plural), which bypasses rc-field-form's
  // dispatch / triggerTimes counter entirely — no circular-reference warning possible.
  // Form.Item display and Form.useWatch both still update normally.
  useEffect(() => {
    if (autoName !== undefined) {
      form.setFieldsValue({ name: autoName });
    }
  }, [autoName, form]);

  // ── Mutation ───────────────────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const { uuid, password, method, username, ...rest } = values;
      const creds: Record<string, string> = {};
      if (uuid)     creds.uuid     = String(uuid);
      if (password) creds.password = String(password);
      if (method)   creds.method   = String(method);
      if (username) creds.username = String(username);
      const payload = { ...(rest as Record<string, unknown>), credentials: creds };
      return isEdit
        ? nodesApi.update(initialValues!.id as string, payload)
        : nodesApi.create(payload as Parameters<typeof nodesApi.create>[0]);
    },
    onSuccess: () => {
      message.success(isEdit ? '节点已更新' : '节点已创建');
      onSuccess();
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ message: string | string[] }>;
      const msgs = axiosErr.response?.data?.message;
      const text = Array.isArray(msgs)
        ? msgs[0]
        : typeof msgs === 'string'
          ? msgs
          : '操作失败';
      message.error(text);
    },
  });

  // ── Form linkage handler ───────────────────────────────────────────────────

  /**
   * setFieldsValue (plural) updates the form store directly, bypassing the
   * dispatch / triggerTimes counter used by rc-field-form's circular-reference
   * detection.  It does NOT trigger onValuesChange, so there is no cascading
   * callback.  Form.Item display values and Form.useWatch both still update
   * because setFieldsValue calls notifyObservers + notifyWatch internally.
   *
   * We keep queueMicrotask only for the serverId-derived state update, which
   * is plain React state and needs no delay.
   */
  function handleValuesChange(changed: Record<string, unknown>) {
    // Plain React state — no form API involved
    if ('serverId' in changed) {
      setServerId(changed.serverId as string | undefined);
    }

    // Batch all programmatic field updates into one setFieldsValue call.
    // queueMicrotask defers until the current onValuesChange dispatch finishes,
    // though with setFieldsValue this is optional (it's safe either way).
    queueMicrotask(() => {
      const updates: Record<string, unknown> = {};

      if ('protocol' in changed) {
        const proto = changed.protocol as string;
        const valid = IMPL_OPTIONS[proto] ?? ALL_IMPLS;
        const preferred = IMPL_MAP[proto] ?? 'XRAY';
        updates.implementation = valid.includes(preferred) ? preferred : valid[0];
        // REALITY is only valid for VLESS / TROJAN — reset TLS if incompatible
        if (!['VLESS', 'TROJAN'].includes(proto) && form.getFieldValue('tls') === 'REALITY') {
          updates.tls = 'NONE';
        }
      }

      if ('tls' in changed && changed.tls === 'REALITY') {
        if (form.getFieldValue('transport') !== 'TCP') {
          updates.transport = 'TCP';
        }
        if (!form.getFieldValue('domain')) {
          updates.domain = 'www.google.com';
        }
      }

      if (Object.keys(updates).length > 0) {
        form.setFieldsValue(updates);
      }
    });
  }

  // ── Quick-generate helpers ─────────────────────────────────────────────────

  function generateUuid() {
    form.setFieldValue('uuid', crypto.randomUUID());
  }

  function generatePass() {
    form.setFieldValue('password', randomPassword());
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑节点' : '新增节点'}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      width={580}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => mutation.mutate(v as Record<string, unknown>)}
        onValuesChange={handleValuesChange}
        initialValues={{ tls: 'NONE', implementation: 'XRAY', transport: 'TCP', enabled: true }}
      >
        {/* ── 基础信息 ─────────────────────────────────────────────────────── */}
        <Divider orientation="left" orientationMargin={0}>基础信息</Divider>

        <Form.Item name="serverId" label="服务器" rules={[{ required: true }]}>
          <Select placeholder="选择服务器">
            {servers?.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item name="name" label="节点名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>

        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>

        {/* ── 协议配置 ─────────────────────────────────────────────────────── */}
        <Divider orientation="left" orientationMargin={0}>协议配置</Divider>

        <Form.Item name="protocol" label="协议" rules={[{ required: true }]}>
          <Select placeholder="选择协议">
            {['VMESS', 'VLESS', 'TROJAN', 'SHADOWSOCKS', 'SOCKS5', 'HTTP'].map((p) => (
              <Option key={p} value={p}>{p}</Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="implementation" label="实现">
          <Select allowClear>
            {implOptions.map((i) => <Option key={i} value={i}>{i}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item name="transport" label="传输">
          <Select allowClear>
            {['TCP', 'WS', 'GRPC'].map((t) => <Option key={t} value={t}>{t}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item name="tls" label="TLS">
          <Select>
            {tlsOptions.map((t) => <Option key={t} value={t}>{t}</Option>)}
          </Select>
        </Form.Item>

        <Form.Item label="监听端口" required>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item
              name="listenPort"
              noStyle
              rules={[
                { required: true, message: '请输入监听端口' },
                {
                  warningOnly: true,
                  validator: (_, value) => {
                    const isCurrentPort = isEdit && value === initialValues?.listenPort;
                    if (value && usedPorts.has(value) && !isCurrentPort) {
                      return Promise.reject('该端口已被同服务器其他节点占用');
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Button onClick={generatePort}>生成</Button>
          </Space.Compact>
        </Form.Item>

        <Form.Item
          name="domain"
          label={domainLabel}
          rules={isReality ? [{ required: true, message: '请输入伪装域名' }] : []}
        >
          <Input placeholder={isReality ? 'www.google.com' : '可选'} />
        </Form.Item>

        {isEdit && isReality && credentials?.realityPublicKey && (
          <Form.Item label="REALITY 公钥（客户端填此值）">
            <Space.Compact style={{ width: '100%' }}>
              <Input value={credentials.realityPublicKey} readOnly />
              <Button
                onClick={() => navigator.clipboard.writeText(credentials!.realityPublicKey!)}
              >
                复制
              </Button>
            </Space.Compact>
          </Form.Item>
        )}

        {/* ── 凭证信息 ─────────────────────────────────────────────────────── */}
        {showCreds && (
          <Divider orientation="left" orientationMargin={0}>凭证信息</Divider>
        )}

        {showUuid && (
          <Form.Item label="UUID">
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item
                name="uuid"
                noStyle
                rules={[
                  {
                    pattern: UUID_PATTERN,
                    message: 'UUID 格式不正确（xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）',
                  },
                ]}
              >
                <Input placeholder="留空自动生成" />
              </Form.Item>
              <Button onClick={generateUuid}>生成</Button>
            </Space.Compact>
          </Form.Item>
        )}

        {showUsername && (
          <Form.Item name="username" label="用户名">
            <Input placeholder="可选" />
          </Form.Item>
        )}

        {showPassword && (
          <Form.Item label="密码" required={passwordRequired}>
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item
                name="password"
                noStyle
                rules={[
                  { required: passwordRequired, message: '请输入密码' },
                ]}
              >
                <Input.Password placeholder={passwordRequired ? '' : '可选'} />
              </Form.Item>
              <Button onClick={generatePass}>生成</Button>
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
