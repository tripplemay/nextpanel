'use client';

import { useState } from 'react';
import { Alert, App, Button, Form, Select, Space, Switch, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
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
  const known: Record<string, string> = {
    'CF-only subscriptions require 1-20 managed nodes and no external nodes': '严格 CF-only 仅允许 1–20 个托管 CF 节点，不能包含外部节点。混合订阅请仅开启 CF 自动优选。',
    'CF-only requires managed VLESS+WS+TLS nodes on port 443 with a Cloudflare domain': '严格 CF-only 仅支持面板管理的 VLESS+WS+TLS/443 Cloudflare 节点；其他协议请保留在混合订阅中。',
    'Automatic optimization requires 1-20 compatible managed CF nodes; other nodes may remain': '自动优选需要选中 1–20 个支持的托管 CF 节点；其他协议和外部节点可以保留。',
    'CF node selection is not available': '部分所选节点已删除或不属于当前账号，请刷新后重新选择。',
    'At most 20 managed nodes can have CDN protection': '每条订阅最多保护 20 个 CF 节点，请减少 CF 节点数量。',
  };
  if (typeof value === 'string' && known[value]) return known[value];
  return typeof value === 'string' ? value : Array.isArray(value) ? value.join('; ') : '请求失败，请稍后重试';
}

export default function CfAccessFields({ form, nodes, locked, protectedIds, loading }: {
  form: FormInstance<CreateSubscriptionDto>; nodes: Node[]; locked: boolean; protectedIds: string[]; loading: boolean;
}) {
  const enabled = Form.useWatch('cfOnly', form);
  const automatic = Form.useWatch('cfAuto', form) === true;
  const preferredIps: string[] = Form.useWatch('cfPreferredIps', form) ?? [];
  const selectedIds: string[] = Form.useWatch('nodeIds', form) ?? [];
  const externalIds: string[] = Form.useWatch('externalNodeIds', form) ?? [];
  const [nodeId, setNodeId] = useState<string>();
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ key: string; result: CfAccessCheckResult }>();
  const { message, modal } = App.useApp();
  const eligible = nodes.filter((n) => selectedIds.includes(n.id)
    && n.protocol === 'VLESS' && n.transport === 'WS' && n.tls === 'TLS' && n.listenPort === 443 && n.domain && n.cfDnsRecordId);
  const incompatible = nodes.filter(n => selectedIds.includes(n.id) && !eligible.some(e => e.id === n.id));
  const protectedSelected = protectedIds.filter(id => selectedIds.includes(id));
  const unavailableProtected = incompatible.filter(n => protectedSelected.includes(n.id));
  const strictErrors = [
    ...(selectedIds.length < 1 || selectedIds.length > 20 ? ['严格 CF-only 需要选择 1–20 个托管 CF 节点。'] : []),
    ...(externalIds.length ? [`严格 CF-only 不能包含 ${externalIds.length} 个外部节点；混合订阅请关闭严格模式。`] : []),
    ...(incompatible.length ? [`不兼容严格 CF-only：${incompatible.map(n => n.name).join('、')}。`] : []),
  ];
  const selectedNode = eligible.find((n) => n.id === nodeId);
  const checkKey = JSON.stringify([nodeId, selectedNode?.domain, ip, preferredIps, selectedIds]);
  const currentResult = check?.key === checkKey ? check.result : undefined;
  const optimization = useQuery({ queryKey: ['cf-optimization', nodeId],
    queryFn: () => subscriptionsApi.cfOptimization(nodeId!).then(r => r.data),
    enabled: automatic && !!selectedNode, refetchInterval: 30_000 });
  const carrierNames: Record<string, string> = { TELECOM: '电信', UNICOM: '联通', MOBILE: '移动', GENERIC: '通用云测点' };

  function rollback() {
    modal.confirm({ title: '回退上一批候选并暂停该节点自动维护？',
      content: '仅恢复仍符合 CF 限制的有效结果，不更改源站。没有安全恢复点时会拒绝。',
      onOk: async () => { try { await subscriptionsApi.rollbackCfOptimization(nodeId!); await optimization.refetch(); }
        catch (error) { message.error(subscriptionError(error)); throw error; } } });
  }

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
    <Form.Item name="cfAuto" label="CF 自动优选（支持混合订阅）" valuePropName="checked"
      dependencies={['nodeIds', 'cfOnly']}
      rules={[{ validator: async (_, value) => {
        if (value && (loading || eligible.length < 1 || eligible.length > 20)) {
          throw new Error(loading ? '正在加载节点，请稍后保存。' : `当前有 ${eligible.length} 个兼容 CF 节点；自动优选需要 1–20 个。其他节点可保留。`);
        }
      } }]}>
      <Switch aria-label="CF 自动优选" />
    </Form.Item>
    <Form.Item name="cfOnly" label="严格 CF-only（整条订阅仅允许 CDN 节点）" valuePropName="checked"
      dependencies={['nodeIds', 'externalNodeIds']}
      rules={[{ validator: async (_, value) => {
        if (value && (loading || strictErrors.length)) throw new Error(loading ? '正在加载节点，请稍后保存。' : strictErrors.join(' '));
      } }]}>
      <Switch aria-label="严格 CF-only" disabled={locked} onChange={(checked) => {
        if (checked) form.setFieldValue('cfAuto', true);
        else form.setFieldValue('cfPreferredIps', []);
      }} />
    </Form.Item>
    {enabled && <>
      <Alert type="warning" showIcon title="全程 CDN；源站隐藏需独立验收"
        description="仅支持 1–20 个托管 VLESS+WS+TLS 节点，不可混入其他协议或外部节点。默认线路也固定为已验证的 CF IP；全部不可用则失败，不回退源站。入口/出口共用 IP 仍可能泄漏源站。切换手工模式并清空候选可回退默认 CDN，不关闭 CF-only。" />
      {!!strictErrors.length && <Alert type="error" showIcon title="当前选择不符合严格 CF-only" description={strictErrors.join(' ')} />}
    </>}
    {(enabled || automatic || protectedSelected.length > 0) && <>
      {!enabled && <Alert type="info" showIcon title="混合订阅：仅 CF 节点使用 CDN 优选"
        description={`当前 ${eligible.length} 个兼容 CF 节点，其他 ${selectedIds.length - eligible.length} 个托管节点和 ${externalIds.length} 个外部节点保持原样。CF 节点无安全地址时省略，不回退源站。关闭自动优选后，已保护节点仍使用默认 CDN；请刷新客户端完整订阅。非 CF 节点不具备 CDN 隐藏保证。`} />}
      {!!unavailableProtected.length && <Alert type="warning" showIcon title="部分已保护节点配置发生变化"
        description={`这些节点将停止导出，而不会转为直连：${unavailableProtected.map(n => n.name).join('、')}。`} />}
      {automatic && <Alert type="info" showIcon title="同一订阅包含三网候选，客户端本地择优"
        description="有效测量会自动生成电信、联通、移动候选；缺少测点时仅提供通用/默认 CDN，不冒充运营商实测。Clash/Mihomo 更新一次订阅后每 15 分钟获取候选、每 5 分钟探测；其他客户端需启用订阅更新。" />}
      {enabled && !automatic && <Form.Item name="cfPreferredIps" label="优选 CF IP（按优先顺序，最多 3 个）" style={{ marginTop: 16 }}
        extra="只接受 CF 公网 IPv4/IPv6，不接受域名、端口或 URL。SNI、WS Host 保留原业务域名。留空仅使用默认 CF 线路。"
        rules={[{ type: 'array', max: 3, message: '最多填写 3 个 CF IP' }]}>
        <Select mode="tags" tokenSeparators={[',', ' ', '\n']} options={[]} placeholder="输入 IP 后按回车；不自动推荐未经实测的 IP" />
      </Form.Item>}
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Typography.Text strong>面板侧连通性检查（不代表电信网络速度）</Typography.Text>
        <Select aria-label="检查 CF 节点" style={{ width: '100%' }} placeholder="选择本次要检查的节点"
          value={selectedNode?.id} onChange={setNodeId}
          options={eligible.map((n) => ({ value: n.id, label: `${n.name} — ${n.domain}` }))} />
        {automatic && selectedNode && <>
          {optimization.isError && <Alert type="error" title={subscriptionError(optimization.error)} />}
          {optimization.data && <Alert type="warning" showIcon title={optimization.data.paused ? '该节点自动维护已暂停，候选仍受过期限制' : optimization.data.enabled ? '后台自动维护已开启' : '后台自动维护未开启，当前仅使用已有安全候选/默认 CDN'}
            description={<>
              <div>缺少有效实测：{optimization.data.missingCarriers.map(c => carrierNames[c] ?? c).join('、') || '无'}；机房测点不代表全国用户。</div>
              {optimization.data.budget?.lowBudget && <div>低预算试点：后台每 8 小时复测两轮，并非每 5 分钟持续更新；客户端仍按原周期检查候选。</div>}
              {optimization.data.budget?.monthlyLimit != null && <div>全局每月最多 {optimization.data.budget.monthlyLimit} 批，达到上限后暂停探测；不是云账单硬限额。</div>}
              {optimization.data.budget?.error && <div>月度预算配置无效，已停止新探测，请联系管理员。</div>}
              {(optimization.data.registryError || optimization.data.rangeError) && <div>测点配置或官方网段同步异常，请联系管理员。</div>}
              {optimization.data.profiles.map(p => <div key={p.probeId} style={{ overflowWrap: 'anywhere' }}>
                {carrierNames[p.carrier] ?? p.carrier} / {p.region}：{p.stale ? '未测或结果陈旧' : '近期实测'}，{p.checkedAt ?? '无检测时间'}
                {p.error && `；${p.error}`}
                {p.candidates.map(c => <div key={c.ip}>{c.ip}：{c.latency} ms{c.failed ? '（复查失败）' : ''}</div>)}
              </div>)}
            </>} />}
          <Space wrap>
            <Button onClick={rollback}>回退上一批并暂停</Button>
            <Button onClick={async () => { try { await subscriptionsApi.resumeCfOptimization(nodeId!); await optimization.refetch(); }
              catch (error) { message.error(subscriptionError(error)); } }}>恢复自动维护</Button>
          </Space>
        </>}
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
