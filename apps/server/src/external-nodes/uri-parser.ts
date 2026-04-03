/**
 * Pure URI parsing functions for external node import.
 * Supports: vmess://, vless://, ss://, trojan://, hysteria2://
 * Also handles Base64-encoded subscription content (multi-line URIs).
 */

export interface ExternalNodeData {
  name: string;
  protocol: string;
  address: string;
  port: number;
  uuid?: string;
  password?: string;
  method?: string;
  transport?: string;
  tls: string;
  realityPublicKey?: string;
  sni?: string;
  path?: string;
  rawUri: string;
}

function safeDecodeBase64(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(pad), 'base64').toString('utf8');
}

function safeDecodeURIComponent(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

function parseName(fragment: string | null): string {
  if (!fragment) return '导入节点';
  return safeDecodeURIComponent(fragment) || '导入节点';
}

function parseVmess(uri: string): ExternalNodeData | null {
  try {
    const b64 = uri.slice('vmess://'.length);
    const json = JSON.parse(safeDecodeBase64(b64)) as Record<string, unknown>;
    const port = Number(json.port);
    if (!json.add || isNaN(port)) return null;

    const net = String(json.net ?? 'tcp');
    const tls = json.tls === 'tls' ? 'TLS' : json.tls === 'reality' ? 'REALITY' : 'NONE';
    const transport = net === 'ws' ? 'WS' : net === 'grpc' ? 'GRPC' : net === 'quic' ? 'QUIC' : undefined;

    return {
      name: String(json.ps ?? json.add),
      protocol: 'VMESS',
      address: String(json.add),
      port,
      uuid: String(json.id ?? ''),
      transport,
      tls,
      sni: String(json.sni ?? json.host ?? ''),
      path: String(json.path ?? ''),
      rawUri: uri,
    };
  } catch {
    return null;
  }
}

function parseVless(uri: string): ExternalNodeData | null {
  try {
    const withoutScheme = uri.slice('vless://'.length);
    const hashIdx = withoutScheme.indexOf('#');
    const fragment = hashIdx >= 0 ? withoutScheme.slice(hashIdx + 1) : null;
    const main = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;

    const qIdx = main.indexOf('?');
    const hostPart = qIdx >= 0 ? main.slice(0, qIdx) : main;
    const query = qIdx >= 0 ? new URLSearchParams(main.slice(qIdx + 1)) : new URLSearchParams();

    const atIdx = hostPart.lastIndexOf('@');
    const uuid = atIdx >= 0 ? hostPart.slice(0, atIdx) : '';
    const hostPort = atIdx >= 0 ? hostPart.slice(atIdx + 1) : hostPart;

    const colonIdx = hostPort.lastIndexOf(':');
    const address = colonIdx >= 0 ? hostPort.slice(0, colonIdx) : hostPort;
    const port = colonIdx >= 0 ? Number(hostPort.slice(colonIdx + 1)) : 0;
    if (!address || isNaN(port)) return null;

    const security = query.get('security') ?? '';
    const tls = security === 'tls' ? 'TLS' : security === 'reality' ? 'REALITY' : 'NONE';
    const netType = query.get('type') ?? 'tcp';
    const transport = netType === 'ws' ? 'WS' : netType === 'grpc' ? 'GRPC' : netType === 'quic' ? 'QUIC' : undefined;

    return {
      name: parseName(fragment),
      protocol: 'VLESS',
      address,
      port,
      uuid,
      transport,
      tls,
      realityPublicKey: query.get('pbk') ?? undefined,
      sni: query.get('sni') ?? query.get('host') ?? '',
      path: query.get('path') ?? query.get('serviceName') ?? '',
      rawUri: uri,
    };
  } catch {
    return null;
  }
}

function parseShadowsocks(uri: string): ExternalNodeData | null {
  try {
    const withoutScheme = uri.slice('ss://'.length);
    const hashIdx = withoutScheme.indexOf('#');
    const fragment = hashIdx >= 0 ? withoutScheme.slice(hashIdx + 1) : null;
    const main = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;

    // SIP002: ss://BASE64(method:password)@host:port
    const atIdx = main.lastIndexOf('@');
    let method: string;
    let password: string;
    let address: string;
    let port: number;

    if (atIdx >= 0) {
      const credB64 = main.slice(0, atIdx);
      const hostPort = main.slice(atIdx + 1);
      const decoded = safeDecodeBase64(credB64);
      const colonIdx = decoded.indexOf(':');
      method = colonIdx >= 0 ? decoded.slice(0, colonIdx) : decoded;
      password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
      const hpColon = hostPort.lastIndexOf(':');
      address = hpColon >= 0 ? hostPort.slice(0, hpColon) : hostPort;
      port = hpColon >= 0 ? Number(hostPort.slice(hpColon + 1)) : 0;
    } else {
      // Legacy: ss://BASE64(method:password@host:port)
      const decoded = safeDecodeBase64(main);
      const colonIdx = decoded.indexOf(':');
      method = colonIdx >= 0 ? decoded.slice(0, colonIdx) : '';
      const rest = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
      const atIdx2 = rest.lastIndexOf('@');
      password = atIdx2 >= 0 ? rest.slice(0, atIdx2) : rest;
      const hostPort = atIdx2 >= 0 ? rest.slice(atIdx2 + 1) : '';
      const hpColon = hostPort.lastIndexOf(':');
      address = hpColon >= 0 ? hostPort.slice(0, hpColon) : hostPort;
      port = hpColon >= 0 ? Number(hostPort.slice(hpColon + 1)) : 0;
    }

    if (!address || isNaN(port)) return null;

    return {
      name: parseName(fragment),
      protocol: 'SHADOWSOCKS',
      address,
      port,
      password,
      method,
      tls: 'NONE',
      rawUri: uri,
    };
  } catch {
    return null;
  }
}

function parseTrojan(uri: string): ExternalNodeData | null {
  try {
    const withoutScheme = uri.slice('trojan://'.length);
    const hashIdx = withoutScheme.indexOf('#');
    const fragment = hashIdx >= 0 ? withoutScheme.slice(hashIdx + 1) : null;
    const main = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;

    const qIdx = main.indexOf('?');
    const hostPart = qIdx >= 0 ? main.slice(0, qIdx) : main;
    const query = qIdx >= 0 ? new URLSearchParams(main.slice(qIdx + 1)) : new URLSearchParams();

    const atIdx = hostPart.lastIndexOf('@');
    const password = atIdx >= 0 ? hostPart.slice(0, atIdx) : '';
    const hostPort = atIdx >= 0 ? hostPart.slice(atIdx + 1) : hostPart;
    const colonIdx = hostPort.lastIndexOf(':');
    const address = colonIdx >= 0 ? hostPort.slice(0, colonIdx) : hostPort;
    const port = colonIdx >= 0 ? Number(hostPort.slice(colonIdx + 1)) : 0;
    if (!address || isNaN(port)) return null;

    const security = query.get('security') ?? 'tls';
    const tls = security === 'none' ? 'NONE' : 'TLS';
    const netType = query.get('type') ?? 'tcp';
    const transport = netType === 'ws' ? 'WS' : netType === 'grpc' ? 'GRPC' : undefined;

    return {
      name: parseName(fragment),
      protocol: 'TROJAN',
      address,
      port,
      password,
      transport,
      tls,
      sni: query.get('sni') ?? '',
      path: query.get('path') ?? '',
      rawUri: uri,
    };
  } catch {
    return null;
  }
}

function parseHysteria2(uri: string): ExternalNodeData | null {
  try {
    const scheme = uri.startsWith('hysteria2://') ? 'hysteria2://' : 'hy2://';
    const withoutScheme = uri.slice(scheme.length);
    const hashIdx = withoutScheme.indexOf('#');
    const fragment = hashIdx >= 0 ? withoutScheme.slice(hashIdx + 1) : null;
    const main = hashIdx >= 0 ? withoutScheme.slice(0, hashIdx) : withoutScheme;

    const qIdx = main.indexOf('?');
    const hostPart = qIdx >= 0 ? main.slice(0, qIdx) : main;
    const query = qIdx >= 0 ? new URLSearchParams(main.slice(qIdx + 1)) : new URLSearchParams();

    const atIdx = hostPart.lastIndexOf('@');
    const password = atIdx >= 0 ? hostPart.slice(0, atIdx) : '';
    const hostPort = atIdx >= 0 ? hostPart.slice(atIdx + 1) : hostPart;
    const colonIdx = hostPort.lastIndexOf(':');
    const address = colonIdx >= 0 ? hostPort.slice(0, colonIdx) : hostPort;
    const port = colonIdx >= 0 ? Number(hostPort.slice(colonIdx + 1)) : 0;
    if (!address || isNaN(port)) return null;

    return {
      name: parseName(fragment),
      protocol: 'HYSTERIA2',
      address,
      port,
      password,
      tls: 'TLS',
      sni: query.get('sni') ?? '',
      rawUri: uri,
    };
  } catch {
    return null;
  }
}

export function parseUri(uri: string): ExternalNodeData | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith('vmess://')) return parseVmess(trimmed);
  if (trimmed.startsWith('vless://')) return parseVless(trimmed);
  if (trimmed.startsWith('ss://')) return parseShadowsocks(trimmed);
  if (trimmed.startsWith('trojan://')) return parseTrojan(trimmed);
  if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) return parseHysteria2(trimmed);
  return null;
}

/** Parse raw text: either a single/multi-line URI list, or a Base64 subscription. */
export function parseSubscriptionText(text: string): { nodes: ExternalNodeData[]; failed: number } {
  const trimmed = text.trim();
  let lines: string[];

  // Detect Base64: no newlines and decodes to lines containing ://
  if (!trimmed.includes('\n') && !trimmed.includes('://')) {
    try {
      const decoded = safeDecodeBase64(trimmed);
      lines = decoded.split(/\r?\n/).filter((l) => l.trim());
    } catch {
      lines = [trimmed];
    }
  } else {
    lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  }

  const nodes: ExternalNodeData[] = [];
  let failed = 0;

  for (const line of lines) {
    const result = parseUri(line.trim());
    if (result) nodes.push(result);
    else failed++;
  }

  return { nodes, failed };
}
