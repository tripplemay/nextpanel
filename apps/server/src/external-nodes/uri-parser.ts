/**
 * Pure URI parsing functions for external node import.
 * Supports: vmess://, vless://, ss://, socks://, socks5://, http://, https://,
 * trojan://, hysteria2://, and MiyaIP host:port:username:password entries.
 * Also handles Base64-encoded subscription content (multi-line URIs).
 */

import { parseXhttpExtra, parseXhttpHost, parseXhttpMode } from '../nodes/protocols/xhttp';
import { parseSocksUri } from '../nodes/socks-uri';

export interface ExternalNodeData {
  name: string;
  protocol: string;
  address: string;
  port: number;
  uuid?: string;
  username?: string;
  password?: string;
  method?: string;
  transport?: string;
  tls: string;
  realityPublicKey?: string;
  shortId?: string;
  xhttpMode?: string;
  xhttpHost?: string;
  xhttpExtra?: string;
  sni?: string;
  path?: string;
  rawUri: string;
}

export type BareProxyProtocol = 'HTTP' | 'SOCKS5';

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

function parseHostPort(value: string): { address: string; port: number } | null {
  let address: string;
  let portText: string;

  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']');
    if (closingBracket <= 1 || value[closingBracket + 1] !== ':') return null;
    address = value.slice(1, closingBracket);
    portText = value.slice(closingBracket + 2);
  } else {
    const colonIdx = value.lastIndexOf(':');
    if (colonIdx <= 0) return null;
    address = value.slice(0, colonIdx);
    portText = value.slice(colonIdx + 1);
  }

  const port = Number(portText);
  if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { address, port };
}

function parseTransport(value: string): string | undefined {
  switch (value.toLowerCase()) {
    case 'ws': return 'WS';
    case 'grpc': return 'GRPC';
    case 'quic': return 'QUIC';
    case 'xhttp': return 'XHTTP';
    default: return undefined;
  }
}

function parseVmess(uri: string): ExternalNodeData | null {
  try {
    const b64 = uri.slice('vmess://'.length);
    const json = JSON.parse(safeDecodeBase64(b64)) as Record<string, unknown>;
    const port = Number(json.port);
    if (!json.add || isNaN(port)) return null;

    const net = String(json.net ?? 'tcp');
    const tls = json.tls === 'tls' ? 'TLS' : json.tls === 'reality' ? 'REALITY' : 'NONE';
    const transport = parseTransport(net);
    const isXhttp = transport === 'XHTTP';
    const xhttpMode = isXhttp ? parseXhttpMode(String(json.mode ?? 'auto')) : undefined;
    if (isXhttp && !xhttpMode) return null;
    const xhttpHost = isXhttp ? parseXhttpHost(String(json.host ?? '')) : undefined;
    const xhttpExtra = isXhttp && json.extra !== undefined
      ? (typeof json.extra === 'string' ? json.extra : JSON.stringify(json.extra))
      : undefined;
    if (isXhttp) parseXhttpExtra(xhttpExtra);

    return {
      name: String(json.ps ?? json.add),
      protocol: 'VMESS',
      address: String(json.add),
      port,
      uuid: String(json.id ?? ''),
      transport,
      tls,
      xhttpMode: xhttpMode ?? undefined,
      xhttpHost,
      xhttpExtra,
      sni: json.sni !== undefined
        ? String(json.sni)
        : (isXhttp ? undefined : String(json.host ?? '')),
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

    const parsedHost = parseHostPort(hostPort);
    if (!parsedHost) return null;

    const security = query.get('security') ?? '';
    const tls = security === 'tls' ? 'TLS' : security === 'reality' ? 'REALITY' : 'NONE';
    const transport = parseTransport(query.get('type') ?? 'tcp');
    const isXhttp = transport === 'XHTTP';
    const xhttpMode = isXhttp ? parseXhttpMode(query.get('mode')) : undefined;
    if (isXhttp && !xhttpMode) return null;

    let xhttpHost: string | undefined;
    const xhttpExtra = isXhttp ? query.get('extra') ?? undefined : undefined;
    if (isXhttp) {
      xhttpHost = parseXhttpHost(query.get('host'));
      parseXhttpExtra(xhttpExtra);
    }

    return {
      name: parseName(fragment),
      protocol: 'VLESS',
      address: parsedHost.address,
      port: parsedHost.port,
      uuid,
      transport,
      tls,
      realityPublicKey: query.get('pbk') ?? undefined,
      shortId: query.get('sid') ?? undefined,
      xhttpMode: xhttpMode ?? undefined,
      xhttpHost,
      xhttpExtra,
      sni: query.get('sni') ?? (isXhttp ? undefined : query.get('host') ?? ''),
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
      const parsedHost = parseHostPort(hostPort);
      if (!parsedHost) return null;
      address = parsedHost.address;
      port = parsedHost.port;
    } else {
      // Legacy: ss://BASE64(method:password@host:port)
      const decoded = safeDecodeBase64(main);
      const colonIdx = decoded.indexOf(':');
      method = colonIdx >= 0 ? decoded.slice(0, colonIdx) : '';
      const rest = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
      const atIdx2 = rest.lastIndexOf('@');
      password = atIdx2 >= 0 ? rest.slice(0, atIdx2) : rest;
      const hostPort = atIdx2 >= 0 ? rest.slice(atIdx2 + 1) : '';
      const parsedHost = parseHostPort(hostPort);
      if (!parsedHost) return null;
      address = parsedHost.address;
      port = parsedHost.port;
    }

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

function parseSocks(uri: string): ExternalNodeData | null {
  try {
    const parsed = parseSocksUri(uri);
    return {
      name: parsed.name,
      protocol: 'SOCKS5',
      address: parsed.config.host,
      port: parsed.config.port,
      username: parsed.config.username,
      password: parsed.config.password,
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
    const parsedHost = parseHostPort(hostPort);
    if (!parsedHost) return null;

    const security = query.get('security') ?? 'tls';
    const tls = security === 'none' ? 'NONE' : 'TLS';
    const transport = parseTransport(query.get('type') ?? 'tcp');
    const isXhttp = transport === 'XHTTP';
    const xhttpMode = isXhttp ? parseXhttpMode(query.get('mode')) : undefined;
    if (isXhttp && !xhttpMode) return null;
    const xhttpHost = isXhttp ? parseXhttpHost(query.get('host')) : undefined;
    const xhttpExtra = isXhttp ? query.get('extra') ?? undefined : undefined;
    if (isXhttp) parseXhttpExtra(xhttpExtra);

    return {
      name: parseName(fragment),
      protocol: 'TROJAN',
      address: parsedHost.address,
      port: parsedHost.port,
      password,
      transport,
      tls,
      xhttpMode: xhttpMode ?? undefined,
      xhttpHost,
      xhttpExtra,
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
    const parsedHost = parseHostPort(hostPort);
    if (!parsedHost) return null;

    return {
      name: parseName(fragment),
      protocol: 'HYSTERIA2',
      address: parsedHost.address,
      port: parsedHost.port,
      password,
      tls: 'TLS',
      sni: query.get('sni') ?? '',
      rawUri: uri,
    };
  } catch {
    return null;
  }
}

function parseHttp(uri: string): ExternalNodeData | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    if (!parsed.hostname || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    const username = parsed.username ? safeDecodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? safeDecodeURIComponent(parsed.password) : undefined;
    if ((username === undefined) !== (password === undefined)) return null;
    const fragment = parsed.hash ? parsed.hash.slice(1) : null;
    const address = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
    return {
      name: parseName(fragment),
      protocol: 'HTTP',
      address,
      port,
      username,
      password,
      tls: parsed.protocol === 'https:' ? 'TLS' : 'NONE',
      sni: parsed.protocol === 'https:' ? address : undefined,
      rawUri: uri,
    };
  } catch {
    return null;
  }
}

/** MiyaIP compact format: host:port:username:password (HTTP or SOCKS5). */
function parseBareProxy(value: string, protocol: BareProxyProtocol): ExternalNodeData | null {
  const trimmed = value.trim();
  let address: string;
  let portText: string;
  let username: string;
  let password: string;

  if (trimmed.startsWith('[')) {
    const closingBracket = trimmed.indexOf(']');
    if (closingBracket <= 1 || trimmed[closingBracket + 1] !== ':') return null;
    const fields = trimmed.slice(closingBracket + 2).split(':');
    if (fields.length < 3) return null;
    address = trimmed.slice(1, closingBracket);
    [portText, username] = fields;
    password = fields.slice(2).join(':');
  } else {
    const fields = trimmed.split(':');
    if (fields.length < 4) return null;
    [address, portText, username] = fields;
    password = fields.slice(3).join(':');
  }

  const parsedHost = parseHostPort(`${address.includes(':') ? `[${address}]` : address}:${portText}`);
  if (!parsedHost || !username || !password) return null;
  if (/^[\u0000-\u001f\u007f]/.test(username) || /[\u0000-\u001f\u007f]/.test(username + password)) return null;

  return {
    name: 'MiyaIP',
    protocol,
    address: parsedHost.address,
    port: parsedHost.port,
    username,
    password,
    tls: 'NONE',
    rawUri: trimmed,
  };
}

export function parseUri(uri: string, bareProtocol: BareProxyProtocol = 'HTTP'): ExternalNodeData | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith('vmess://')) return parseVmess(trimmed);
  if (trimmed.startsWith('vless://')) return parseVless(trimmed);
  if (trimmed.startsWith('ss://')) return parseShadowsocks(trimmed);
  if (/^socks5?:\/\//i.test(trimmed)) return parseSocks(trimmed);
  if (trimmed.startsWith('trojan://')) return parseTrojan(trimmed);
  if (trimmed.startsWith('hysteria2://') || trimmed.startsWith('hy2://')) return parseHysteria2(trimmed);
  if (/^https?:\/\//i.test(trimmed)) return parseHttp(trimmed);
  return parseBareProxy(trimmed, bareProtocol);
}

/** Parse raw text: either a single/multi-line URI list, or a Base64 subscription. */
export function parseSubscriptionText(
  text: string,
  bareProtocol: BareProxyProtocol = 'HTTP',
): { nodes: ExternalNodeData[]; failed: number } {
  const trimmed = text.trim();
  let lines: string[];

  // MiyaIP compact entries contain no URI scheme and can otherwise look like
  // an unpadded Base64 string. Check the single-entry form before decoding.
  if (parseBareProxy(trimmed, bareProtocol)) {
    lines = [trimmed];
  } else if (!trimmed.includes('\n') && !trimmed.includes('://')) {
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
    const result = parseUri(line.trim(), bareProtocol);
    if (result) nodes.push(result);
    else failed++;
  }

  return { nodes, failed };
}
