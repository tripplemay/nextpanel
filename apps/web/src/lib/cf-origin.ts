import type { Node } from '@/types/api';

export function cfEndpointReady(node: Node, now = Date.now()): boolean {
  if (node.publicPort == null) return node.listenPort === 443;
  const r = node.cfOriginRoute;
  const age = now - Date.parse(r?.checkedAt ?? '');
  return node.transport === 'XHTTP' && node.publicPort === 443 && r?.state === 'READY'
    && r.domain === node.domain && r.port === node.listenPort && !!r.ruleId && !!r.rulesetId
    && age >= 0 && age < 20 * 60_000;
}
