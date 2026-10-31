'use client';

import { useState } from 'react';
import { Alert, App, Button, Form, Select, Space, Switch, Typography } from 'antd';
import type { FormInstance } from 'antd';
import { subscriptionsApi } from '@/lib/api';
import type { CfAccessCheckResult, CreateSubscriptionDto, Node } from '@/types/api';

const FINDINGS: Record<string, string> = {
  ENTRY_IS_EXIT: '入口同时作为出口，出口 IP 可能直接暴露入口源站，需要独立入口/出口。',
  ENTRY_EXIT_SAME_IP: '入口和出口使用相同公网 IP，需要分离。',
  EXTERNAL_EXIT_UNVERIFIED: '外部 SOCKS5 出口尚未核验是否与入口共用 IP。',
  OTHER_DIRECT_NODE_ON_ENTRY: '同一入口 IP 上存在其他直连协议节点，可能泄漏源站地址。',
  DNS_HISTORY_AND_FIREWALL_UNVERIFIED: '尚未核验历史 DNS、其他 DNS-only 记录和源站回源防火墙。',
  DEFAULT_DNS_NOT_CF_OR_UNAVAILABLE: '默认域名未能解析为纯 CF 地址，默认线路将被省略；无候选则拒绝导出。',
};

export function subscriptionError(error: unknown): string {
  const value = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof value === 'string' ? value : Array.isArray(value) ? value.join('; ') : '请求失败，请稍后重试';
}

export default function CfAccessFields({ form, nodes, locked }: {
  form: FormInstance<CreateSubscriptionDto>; nodes: Node[]; locked: boolean;
}) {
  const enabled = Form.useWatch('cfOnly', form);
  const preferredIps: string[] = Form.useWatch('cfPreferredIps', form) ?? [];
  const selectedIds: string[] = Form.useWatch('nodeIds', form) ?? [];
  const [nodeId, setNodeId] = useState<string>();
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ key: string; result: CfAccessCheckResult }>();
  const { message } = App.useApp();
  const eligible = nodes.filter((n) => selectedIds.includes(n.id)
    && n.protocol === 'VLESS' && n.transport === 'WS' && n.tls === 'TLS' && n.listenPort === 443 && n.domain);
  const selectedNode = eligible.find((n) => n.id === nodeId);
  const checkKey = JSON.stringify([nodeId, selectedNode?.domain, ip, preferredIps, selectedIds]);
  const currentResult = check?.key === checkKey ? check.result : undefined;

  async function runCheck() {
    if (!selectedNode) return;
    setBusy(true);
    try {
      const result = (await subscriptionsApi.checkCfAccess({ nodeId: selectedNode.id, ...(ip ? { ip } : {}) })).data;
      setCheck({ key: checkKey, result });
    } catch (error) {
      setCheck(undefined);
      message.error(subscriptionError(error));
    } finally { setBusy(false); }
  }

  return <>
    <Form.Item name="cfOnly" label="CF-only 接入（中国大陆电信试点）" valuePropName="checked">
      <Switch disabled={locked} onChange={(checked) => { if (!checked) form.setFieldValue('cfPreferredIps', []); }} />
    </Form.Item>
    {enabled && <>
      <Alert type="warning" showIcon title="全程 CDN；源站隐藏需独立验收"
        description="仅支持 1–20 个托管 VLESS+WS+TLS 节点，不可混入其他协议或外部节点。默认线路也固定为已验证的 CF IP；全部不可用则失败，不回退源站。入口/出口共用 IP 仍可能泄漏源站。启用后清空候选即可回退默认 CDN，不关闭 CF-only。" />
      <Form.Item name="cfPreferredIps" label="优选 CF IP（按优先顺序，最多 3 个）" style={{ marginTop: 16 }}
        extra="只接受 CF 公网 IPv4/IPv6，不接受域名、端口或 URL。SNI、WS Host 保留原业务域名。留空仅使用默认 CF 线路。"
        rules={[{ type: 'array', max: 3, message: '最多填写 3 个 CF IP' }]}>
        <Select mode="tags" tokenSeparators={[',', ' ', '\n']} options={[]} placeholder="输入 IP 后按回车；不自动推荐未经实测的 IP" />
      </Form.Item>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Typography.Text strong>面板侧连通性检查（不代表电信网络速度）</Typography.Text>
        <Select aria-label="检查 CF 节点" style={{ width: '100%' }} placeholder="选择本次要检查的节点"
          value={selectedNode?.id} onChange={setNodeId}
          options={eligible.map((n) => ({ value: n.id, label: `${n.name} — ${n.domain}` }))} />
        <Select aria-label="检查 CF 接入地址" style={{ width: '100%' }} value={ip} onChange={setIp}
          options={[{ value: '', label: '默认 CF 地址（解析并验证后固定）' }, ...preferredIps.map((value) => ({ value, label: value }))]} />
        <Button onClick={runCheck} loading={busy} disabled={!selectedNode || (!!ip && !preferredIps.includes(ip))}>检查所选线路与源站风险</Button>
        {currentResult && <>
          <Alert type={currentResult.reachable ? 'success' : 'error'} showIcon
            title={`${currentResult.address ?? '无可用 CF 地址'}：${currentResult.message}`}
            description={`测点：面板服务器；时间：${currentResult.testedAt}。请在实际电信网络更新订阅后，用 Clash 做高峰/非高峰验证。`} />
          <Alert type="warning" showIcon title="源站隐藏：未验收"
            description={<ul style={{ paddingLeft: 18, margin: 0 }}>{currentResult.audit.findings.map((finding) =>
              <li key={finding}>{FINDINGS[finding] ?? finding}</li>)}</ul>} />
        </>}
      </Space>
    </>}
  </>;
}
