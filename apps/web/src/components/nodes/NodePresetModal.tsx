'use client';

import { useEffect, useState } from 'react';
import { Alert, App, Collapse, Modal, Form, Input, Select, Tag, Space, Radio, Segmented } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';
import StatusTag from '@/components/common/StatusTag';
import type { CreateChainNodeDto, CreateNodeFromPresetDto, Node } from '@/types/api';
import type { AxiosError } from 'axios';

const { Option } = Select;

type DeployMode = 'direct' | 'chain';
type ChainExitType = 'MANAGED_SERVER' | 'SOCKS5';

function accessStatus(mode: string | undefined) {
  if (mode === 'CDN') return 'CDN_ACCESS';
  if (mode === 'DIRECT') return 'DIRECT_ACCESS';
  return 'ACCESS_UNCONFIRMED';
}

interface Props {
  open: boolean;
  title?: string;
  onClose: () => void;
  onSuccess: (node: Node) => void;
  defaultServerId?: string;
  defaultDeployMode?: DeployMode;
  defaultEntryServerId?: string;
  defaultExitServerId?: string;
  lockDeployMode?: boolean;
  lockServerId?: boolean;
  lockEntryServerId?: boolean;
}

export default function NodePresetModal({
  open,
  title = '新增节点',
  onClose,
  onSuccess,
  defaultServerId,
  defaultDeployMode = 'direct',
  defaultEntryServerId,
  defaultExitServerId,
  lockDeployMode = false,
  lockServerId = false,
  lockEntryServerId = false,
}: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const selectedPreset = Form.useWatch('preset', form);
  const xhttpMode = Form.useWatch('xhttpMode', form);
  const isXhttpCdn = ['VLESS_XHTTP_TLS', 'VLESS_XHTTP_H3_TLS'].includes(selectedPreset);
  const [deployMode, setDeployMode] = useState<DeployMode>('direct');
  const [chainExitType, setChainExitType] = useState<ChainExitType>('MANAGED_SERVER');
  const [serverId, setServerId] = useState<string | undefined>(undefined);

  const { data: presets } = useQuery({
    queryKey: ['node-presets'],
    queryFn: () => nodesApi.listPresets().then((r) => r.data),
    staleTime: 30_000,
  });
  const preset = presets?.find((item) => item.value === selectedPreset);
  const accessMode = preset?.accessMode;
  const ingressTarget = deployMode === 'chain' ? '入口服务器' : '服务器';
  const trafficPath = [
    '客户端',
    ...(accessMode === 'CDN' ? ['Cloudflare CDN'] : []),
    ingressTarget,
    ...(deployMode === 'chain' ? ['出口'] : []),
  ].join(' → ');

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: () => serversApi.list().then((r) => r.data as { id: string; name: string }[]),
    enabled: open,
  });

  // For direct mode, use serverId; for chain mode, use entryServerId
  const effectiveServerId = deployMode === 'direct' ? serverId : form.getFieldValue('entryServerId') as string | undefined;

  const { data: serverNodes } = useQuery({
    queryKey: ['nodes', effectiveServerId],
    queryFn: () => nodesApi.list(effectiveServerId).then((r) => r.data),
    enabled: open && !!effectiveServerId,
  });

  // 根据服务器名和已有节点序号自动生成节点名称
  useEffect(() => {
    const sid = deployMode === 'direct' ? serverId : form.getFieldValue('entryServerId') as string | undefined;
    if (!sid || !servers || serverNodes === undefined) return;
    const server = servers.find((s) => s.id === sid);
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
    form.setFieldsValue({ name: `${server.name}-${n}` });
  }, [serverId, servers, serverNodes, form, deployMode]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setDeployMode(defaultDeployMode);
      setChainExitType('MANAGED_SERVER');
      const safeDefaultServerId = typeof defaultServerId === 'string' ? defaultServerId : undefined;
      const safeDefaultEntryServerId = typeof defaultEntryServerId === 'string' ? defaultEntryServerId : undefined;
      const safeDefaultExitServerId = typeof defaultExitServerId === 'string' ? defaultExitServerId : undefined;

      if (defaultDeployMode === 'chain') {
        form.setFieldsValue({
          entryServerId: safeDefaultEntryServerId,
          exitServerId: safeDefaultExitServerId,
        });
        setServerId(safeDefaultEntryServerId);
      } else if (safeDefaultServerId) {
        form.setFieldsValue({
          serverId: safeDefaultServerId,
        });
        setServerId(safeDefaultServerId);
      } else {
        setServerId(undefined);
      }
    }
  }, [open, form, defaultDeployMode, defaultServerId, defaultEntryServerId, defaultExitServerId]);

  const directMutation = useMutation({
    mutationFn: (values: CreateNodeFromPresetDto) =>
      nodesApi.createFromPreset(values),
    onSuccess: (res) => {
      onSuccess(res.data);
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ message: string | string[] }>;
      const msgs = axiosErr.response?.data?.message;
      const text = Array.isArray(msgs) ? msgs[0] : typeof msgs === 'string' ? msgs : '创建失败';
      message.error(text);
    },
  });

  const chainMutation = useMutation({
    mutationFn: (values: CreateChainNodeDto) =>
      nodesApi.createChainNode(values),
    onSuccess: (res) => {
      onSuccess(res.data);
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ message: string | string[] }>;
      const msgs = axiosErr.response?.data?.message;
      const text = Array.isArray(msgs) ? msgs[0] : typeof msgs === 'string' ? msgs : '创建失败';
      message.error(text);
    },
  });

  const isPending = directMutation.isPending || chainMutation.isPending;
  useEffect(() => {
    if (directMutation.isError || chainMutation.isError) void queryClient.invalidateQueries({ queryKey: ['nodes'] });
  }, [directMutation.isError, chainMutation.isError, queryClient]);

  function handleFinish(values: Record<string, unknown>) {
    const mode = values.preset === 'VLESS_XHTTP_TLS'
      ? { xhttpMode: (values.xhttpMode ?? 'packet-up') as 'packet-up' | 'stream-up' } : {};
    if (deployMode === 'chain') {
      const { entryServerId, exitServerId, socksUri, preset, name } = values as {
        entryServerId: string; exitServerId?: string; socksUri?: string; preset: string; name: string;
      };
      if (chainExitType === 'MANAGED_SERVER' && entryServerId === exitServerId) {
        message.error('入口和出口不能是同一台服务器');
        return;
      }
      chainMutation.mutate({
        entryServerId,
        exitType: chainExitType,
        preset,
        name,
        ...mode,
        ...(chainExitType === 'MANAGED_SERVER' ? { exitServerId } : { socksUri }),
      });
    } else {
      directMutation.mutate({ serverId: String(values.serverId), preset: String(values.preset), name: String(values.name), ...mode });
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={isPending}
      width={480}
      style={{ maxWidth: '95vw' }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
        onValuesChange={(changed) => {
          if ('serverId' in changed) setServerId(changed.serverId as string | undefined);
          if ('entryServerId' in changed) setServerId(changed.entryServerId as string | undefined);
        }}
      >
        <Form.Item label="部署模式" extra="单机 / 链式决定服务器拓扑；是否经过 CDN 由协议预设决定。">
          <Radio.Group
            value={deployMode}
            disabled={lockDeployMode}
            onChange={(e) => {
              setDeployMode(e.target.value as DeployMode);
              form.resetFields(['serverId', 'entryServerId', 'exitServerId', 'socksUri', 'name']);
              setChainExitType('MANAGED_SERVER');
              setServerId(undefined);
            }}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: '单机', value: 'direct' },
              { label: '链式', value: 'chain' },
            ]}
          />
        </Form.Item>

        {deployMode === 'direct' ? (
          <Form.Item name="serverId" label="服务器" rules={[{ required: true, message: '请选择服务器' }]}>
            <Select placeholder="选择服务器" disabled={lockServerId}>
              {servers?.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
            </Select>
          </Form.Item>
        ) : (
          <>
            <Form.Item name="entryServerId" label="入口服务器" rules={[{ required: true, message: '请选择入口服务器' }]}
              extra="客户端经所选接入方式连接此服务器"
            >
              <Select placeholder="选择入口服务器" disabled={lockEntryServerId}>
                {servers?.map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
              </Select>
            </Form.Item>
            <Form.Item label="出口类型">
              <Segmented
                block
                value={chainExitType}
                onChange={(value) => {
                  setChainExitType(value as ChainExitType);
                  form.resetFields(['exitServerId', 'socksUri']);
                }}
                options={[
                  { label: '托管服务器', value: 'MANAGED_SERVER' },
                  { label: 'SOCKS5 地址', value: 'SOCKS5' },
                ]}
              />
            </Form.Item>
            {chainExitType === 'MANAGED_SERVER' ? (
              <Form.Item name="exitServerId" label="出口服务器" rules={[{ required: true, message: '请选择出口服务器' }]}
                extra="流量从此服务器出站"
              >
                <Select placeholder="选择出口服务器">
                  {servers
                    ?.filter((s) => s.id !== form.getFieldValue('entryServerId'))
                    .map((s) => <Option key={s.id} value={s.id}>{s.name}</Option>)}
                </Select>
              </Form.Item>
            ) : (
              <Form.Item name="socksUri" label="SOCKS5 地址" rules={[{ required: true, message: '请输入 SOCKS5 地址' }]}>
                <Input.Password
                  placeholder="socks://BASE64(username:password)@host:port#name"
                  autoComplete="off"
                />
              </Form.Item>
            )}
          </>
        )}

        <Form.Item name="preset" label="协议预设" rules={[{ required: true, message: '请选择协议预设' }]}
          extra="使用 CF 域名或 TLS 证书，不代表流量经过 CDN。"
        >
          <Select
            placeholder="选择协议预设"
            virtual={false}
            options={presets?.map((p) => ({ value: p.value, label: p.disabled ? `${p.label} · 尚未开放` : p.label, tags: p.tags, accessMode: p.accessMode, disabled: p.disabled }))}
            optionRender={(option) => (
              <div style={{ padding: '4px 0' }}>
                <Space size={4} wrap style={{ display: 'flex' }}>
                  <span style={{ whiteSpace: 'normal' }}>{option.data.label}</span>
                  <StatusTag status={accessStatus(option.data.accessMode)} />
                </Space>
                <Space size={4} style={{ marginTop: 4 }} wrap>
                  {option.data.tags?.map((tag: { text: string; color: string }) => (
                    <Tag key={tag.text} color={tag.color} style={{ fontSize: 11, margin: 0 }}>
                      {tag.text}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}
          />
        </Form.Item>

        {selectedPreset && (
          <div role="status" aria-live="polite" aria-label="预期接入方式" style={{ marginBottom: 16 }}>
            {accessMode === 'DIRECT' || accessMode === 'CDN' ? (
              <Alert
                type={accessMode === 'CDN' ? 'info' : 'warning'}
                showIcon
                message={<Space size={4} wrap><span>预期接入方式</span><StatusTag status={accessStatus(accessMode)} /></Space>}
                description={
                  <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    <div>{trafficPath}</div>
                    <div>{preset?.description}</div>
                    {accessMode === 'CDN' ? (
                      <>
                        <div>待部署验证：DNS 代理、证书与回源配置完成后才生效；选择预设不代表已受保护。</div>
                        <div>保护范围仅为此入口。源站 IP 是否隐藏，还取决于同一 IP 上是否存在直连节点或 DNS-only 记录。</div>
                      </>
                    ) : (
                      <div>不提供 CDN 保护，{ingressTarget}公网 IP 对客户端可见。需要 CDN 保护时，请选择 VLESS + WS / XHTTP + TLS 预设。</div>
                    )}
                  </Space>
                }
              />
            ) : (
              <Alert type="warning" showIcon message="接入方式待确认"
                description="未收到此预设的接入方式信息，请刷新页面或联系管理员确认；不要将 CF 域名视为 CDN 保护。" />
            )}
          </div>
        )}

        {selectedPreset === 'VLESS_XHTTP_TLS' && (
          <Form.Item name="xhttpMode" label="XHTTP 上传模式" initialValue="packet-up" preserve={false}
            extra="HTTP/2；不修改已有节点。stream-up 需在 Cloudflare → 网络中开启 gRPC；API 无法读取该开关，部署时验证真实 CDN 链路，不自动修改区域设置。">
            <Select options={[
              { value: 'packet-up', label: 'packet-up · 兼容默认' },
              { value: 'stream-up', label: 'stream-up · 持续流式上传' },
            ]} />
          </Form.Item>
        )}
        {isXhttpCdn && (selectedPreset === 'VLESS_XHTTP_H3_TLS' || xhttpMode === 'stream-up') && (
          <Alert type="warning" showIcon style={{ marginBottom: 16 }}
            message={selectedPreset === 'VLESS_XHTTP_H3_TLS' ? 'HTTP/3 · packet-up' : 'HTTP/2 · stream-up'}
            description={selectedPreset === 'VLESS_XHTTP_H3_TLS'
              ? '需开启 CF HTTP/3、客户端支持 XHTTP/H3 且网络允许 UDP/443。仅客户端到 CDN 使用 H3，回源仍为 TLS/H2，不开放源站 UDP。不自动降级；建议保留 H2 / WS 节点。'
              : '需开启 CF gRPC，并允许对应路径通过 WAF。适合持续上传，但不保证比 packet-up 更快；应先对照拨测。'} />
        )}
        {isXhttpCdn && (
          <Collapse size="small" style={{ marginBottom: 16 }} items={[{
            key: 'xhttp-requirements',
            label: 'XHTTP 部署与客户端要求 · 不替换网站或 WS',
            children: <Alert type="warning" showIcon
              message="独立 CDN 试点，不替换 WS"
              description="自动检测端口；443 被网站或 WS 占用时，保留原服务，使用空闲回源端口，客户端仍连接 Cloudflare 443。映射回源需有效 CF 域名、Origin Rules 权限、Full (strict) TLS 及 nftables；新模式预检还需 Zone Settings Read 权限。使用新版 Mihomo / OpenClash 或支持该模式的 Shadowrocket，订阅启用 XHTTP 导出；不支持 XHTTP 的客户端继续使用 WS。两地探针也需发布支持对应模式的版本后才能产生优选结果。" />,
          }]} />
        )}

        <Form.Item
          name="name"
          label="节点名称"
          rules={[{ required: true, message: '请输入节点名称' }]}
        >
          <Input placeholder="选择服务器后自动生成" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
