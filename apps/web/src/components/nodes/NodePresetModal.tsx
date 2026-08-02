'use client';

import { useEffect, useState } from 'react';
import { App, Modal, Form, Input, Select, Tag, Space, Radio, Segmented } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { nodesApi, serversApi } from '@/lib/api';
import type { CreateChainNodeDto, Node } from '@/types/api';
import type { AxiosError } from 'axios';

const { Option } = Select;

type DeployMode = 'direct' | 'chain';
type ChainExitType = 'MANAGED_SERVER' | 'SOCKS5';

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
  const [form] = Form.useForm();
  const [deployMode, setDeployMode] = useState<DeployMode>('direct');
  const [chainExitType, setChainExitType] = useState<ChainExitType>('MANAGED_SERVER');
  const [serverId, setServerId] = useState<string | undefined>(undefined);

  const { data: presets } = useQuery({
    queryKey: ['node-presets'],
    queryFn: () => nodesApi.listPresets().then((r) => r.data),
    staleTime: Infinity, // presets never change at runtime
  });

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
    mutationFn: (values: { serverId: string; preset: string; name: string }) =>
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

  function handleFinish(values: Record<string, unknown>) {
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
        ...(chainExitType === 'MANAGED_SERVER' ? { exitServerId } : { socksUri }),
      });
    } else {
      directMutation.mutate(values as { serverId: string; preset: string; name: string });
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
        <Form.Item label="部署模式">
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
              { label: '直连', value: 'direct' },
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
              extra="用户连接到此服务器"
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

        <Form.Item name="preset" label="协议预设" rules={[{ required: true, message: '请选择协议预设' }]}>
          <Select
            placeholder="选择协议预设"
            options={presets?.map((p) => ({ value: p.value, label: p.label, tags: p.tags }))}
            optionRender={(option) => (
              <div style={{ padding: '4px 0' }}>
                <div>{option.data.label}</div>
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
