/**
 * Pure functions for building proxy share URIs, Clash YAML proxies, and Sing-box outbounds.
 * No IO, no side effects.
 */

export interface NodeExportInfo {
  name: string;
  protocol: string;
  host: string;
  port: number;
  transport: string | null;
  tls: string;
  domain: string | null;
  credentials: Record<string, string>;
}

import { REALITY_DEFAULT_SNI, REALITY_FLOW } from '../nodes/protocols/reality';
import { parseXhttpExtra, parseXhttpHost, parseXhttpMode } from '../nodes/protocols/xhttp';

// ─── Share URI (vmess://, vless://, etc.) ────────────────────────────────────

export function buildShareUri(node: NodeExportInfo): string | null {
  const { protocol, host, port, name, transport, tls, domain, credentials: creds } = node;
  const tag = encodeURIComponent(name);
  const net = toClashNet(transport);
  const authorityHost = formatUriHost(host);

  switch (protocol) {
    case 'VMESS': {
      const xhttpMode = net === 'xhttp' ? requireXhttpMode(creds.xhttpMode) : '';
      const xhttpHost = net === 'xhttp' ? parseXhttpHost(creds.xhttpHost) : undefined;
      if (net === 'xhttp' && creds.xhttpExtra !== undefined) {
        parseXhttpExtra(creds.xhttpExtra);
      }
      const obj: Record<string, string> = {
        v: '2',
        ps: name,
        add: host,
        port: String(port),
        id: creds.uuid ?? '',
        aid: '0',
        scy: 'auto',
        net,
        type: 'none',
        host: net === 'xhttp' ? (xhttpHost ?? '') : (domain ?? ''),
        path: net === 'ws' ? '/' : net === 'grpc' ? 'grpc' : net === 'xhttp' ? normalizeXhttpPath(creds.path) : '',
        ...(net === 'xhttp' ? { mode: xhttpMode } : {}),
        ...(net === 'xhttp' && creds.xhttpExtra !== undefined ? { extra: creds.xhttpExtra } : {}),
        tls: tls === 'TLS' ? 'tls' : tls === 'REALITY' ? 'reality' : '',
        sni: domain ?? '',
      };
      return `vmess://${Buffer.from(JSON.stringify(obj)).toString('base64')}`;
    }

    case 'VLESS': {
      const params = new URLSearchParams({ encryption: 'none' });
      // XHTTP does not support the Vision flow used by raw TCP REALITY nodes.
      if (tls === 'REALITY' && net !== 'xhttp') params.set('flow', REALITY_FLOW);
      addTransportParams(params, net, domain, creds);
      addTlsParams(params, tls, domain, creds);
      return `vless://${creds.uuid ?? ''}@${authorityHost}:${port}?${params.toString()}#${tag}`;
    }

    case 'TROJAN': {
      const params = new URLSearchParams();
      addTransportParams(params, net, domain, creds);
      addTlsParams(params, tls, domain, creds);
      const qs = params.toString();
      return `trojan://${creds.password ?? ''}@${authorityHost}:${port}${qs ? '?' + qs : ''}#${tag}`;
    }

    case 'SHADOWSOCKS': {
      const method = creds.method ?? 'aes-256-gcm';
      const userInfo = Buffer.from(`${method}:${creds.password ?? ''}`).toString('base64');
      return `ss://${userInfo}@${authorityHost}:${port}#${tag}`;
    }

    case 'HYSTERIA2': {
      // hy2://password@host:port?sni=domain#name
      const params = new URLSearchParams();
      if (domain) params.set('sni', domain);
      const qs = params.toString();
      return `hy2://${encodeURIComponent(creds.password ?? '')}@${authorityHost}:${port}${qs ? '?' + qs : ''}#${tag}`;
    }

    case 'TUIC':
      // TUIC has no interoperable URI standard; use structured subscriptions.
      return null;

    case 'ANYTLS':
      {
        const params = new URLSearchParams({ insecure: '0' });
        if (domain) params.set('sni', domain);
        return `anytls://${encodeURIComponent(creds.password ?? '')}@${authorityHost}:${port}/?${params.toString()}#${tag}`;
      }

    case 'SOCKS5': {
      const userInfo = creds.username !== undefined
        ? `${encodeURIComponent(creds.username)}:${encodeURIComponent(creds.password ?? '')}@`
        : '';
      return `socks5://${userInfo}${authorityHost}:${port}#${tag}`;
    }

    case 'HTTP':
      return `http://${authorityHost}:${port}#${tag}`;

    default:
      return null;
  }
}

// ─── Clash YAML proxy entry ───────────────────────────────────────────────────

export function buildClashProxy(node: NodeExportInfo): string | null {
  const { protocol, host, port, name, transport, tls, domain, credentials: creds } = node;
  // Mihomo currently implements XHTTP only for VLESS outbounds.
  if (transport === 'XHTTP' && protocol !== 'VLESS') return null;
  const net = toClashNet(transport);
  const tlsEnabled = tls === 'TLS' || tls === 'REALITY';
  const sni = tls === 'REALITY' ? (domain ?? REALITY_DEFAULT_SNI) : (domain ?? '');

  const lines: string[] = [];

  function add(key: string, value: string | number | boolean) {
    lines.push(`    ${key}: ${yamlScalar(value)}`);
  }

  lines.push(`  - name: ${yamlScalar(name)}`);

  switch (protocol) {
    case 'VMESS': {
      add('type', 'vmess');
      add('server', host);
      add('port', port);
      add('uuid', creds.uuid ?? '');
      add('alterId', 0);
      add('cipher', 'auto');
      add('udp', true);
      add('network', net);
      if (tls === 'REALITY') add('flow', REALITY_FLOW);
      if (tlsEnabled) add('tls', true);
      if (sni) add('servername', sni);
      if (net === 'ws') {
        lines.push(`    ws-opts:`);
        lines.push(`      path: /`);
        if (sni) lines.push(`      headers:`);
        if (sni) lines.push(`        Host: ${sni}`);
      } else if (net === 'grpc') {
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: grpc`);
      } else if (net === 'xhttp') {
        addClashXhttpOptions(lines, creds);
      }
      if (tls === 'REALITY') {
        lines.push(`    client-fingerprint: chrome`);
        lines.push(`    reality-opts:`);
        lines.push(`      public-key: ${creds.realityPublicKey ?? ''}`);
        lines.push(`      short-id: ${yamlQuotedString(creds.shortId ?? '')}`);
      }
      break;
    }

    case 'VLESS': {
      add('type', 'vless');
      add('server', host);
      add('port', port);
      add('uuid', creds.uuid ?? '');
      add('udp', true);
      add('network', net);
      if (tls === 'REALITY' && net !== 'xhttp') add('flow', REALITY_FLOW);
      if (tlsEnabled) add('tls', true);
      if (sni) add('servername', sni);
      if (net === 'ws') {
        lines.push(`    ws-opts:`);
        lines.push(`      path: /`);
      } else if (net === 'grpc') {
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: grpc`);
      } else if (net === 'xhttp') {
        addClashXhttpOptions(lines, creds);
      }
      if (tls === 'REALITY') {
        lines.push(`    client-fingerprint: chrome`);
        lines.push(`    reality-opts:`);
        lines.push(`      public-key: ${creds.realityPublicKey ?? ''}`);
        lines.push(`      short-id: ${yamlQuotedString(creds.shortId ?? '')}`);
      }
      break;
    }

    case 'TROJAN': {
      add('type', 'trojan');
      add('server', host);
      add('port', port);
      add('password', creds.password ?? '');
      add('udp', true);
      add('tls', true);
      if (sni) add('sni', sni);
      add('network', net);
      if (net === 'ws') {
        lines.push(`    ws-opts:`);
        lines.push(`      path: /`);
      } else if (net === 'grpc') {
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: grpc`);
      } else if (net === 'xhttp') {
        addClashXhttpOptions(lines, creds);
      }
      break;
    }

    case 'SHADOWSOCKS': {
      add('type', 'ss');
      add('server', host);
      add('port', port);
      add('cipher', creds.method ?? 'aes-256-gcm');
      add('password', creds.password ?? '');
      add('udp', true);
      break;
    }

    case 'HYSTERIA2': {
      add('type', 'hysteria2');
      add('server', host);
      add('port', port);
      add('password', creds.password ?? '');
      add('udp', true);
      if (domain) add('sni', domain);
      add('skip-cert-verify', true);
      break;
    }

    case 'TUIC': {
      add('type', 'tuic');
      add('server', host);
      add('port', port);
      add('uuid', creds.uuid ?? '');
      add('password', creds.password ?? '');
      add('udp', true);
      add('udp-relay-mode', 'native');
      add('congestion-controller', 'bbr');
      add('reduce-rtt', false);
      if (domain) add('sni', domain);
      add('skip-cert-verify', false);
      break;
    }

    case 'ANYTLS': {
      add('type', 'anytls');
      add('server', host);
      add('port', port);
      add('password', creds.password ?? '');
      add('udp', true);
      if (domain) add('sni', domain);
      add('skip-cert-verify', false);
      break;
    }

    case 'SOCKS5': {
      add('type', 'socks5');
      add('server', host);
      add('port', port);
      if (creds.username) add('username', creds.username);
      if (creds.password) add('password', creds.password);
      add('udp', true);
      break;
    }

    case 'HTTP': {
      add('type', 'http');
      add('server', host);
      add('port', port);
      if (creds.username) add('username', creds.username);
      if (creds.password) add('password', creds.password);
      break;
    }

    default:
      return null;
  }

  return lines.join('\n');
}

// ─── Sing-box outbound ────────────────────────────────────────────────────────

export function buildSingboxOutbound(node: NodeExportInfo): Record<string, unknown> | null {
  const { protocol, host, port, name, transport, tls, domain, credentials: creds } = node;

  // sing-box has no XHTTP transport implementation. Exporting this node as a
  // plain VLESS/TCP outbound would silently create a broken, misleading config.
  if (transport === 'XHTTP') return null;

  const tlsObj = buildSingboxTls(tls, domain, creds);
  const transportObj = buildSingboxTransport(transport);

  switch (protocol) {
    case 'VMESS':
      return {
        type: 'vmess',
        tag: name,
        server: host,
        server_port: port,
        uuid: creds.uuid ?? '',
        security: 'auto',
        alter_id: 0,
        ...(transportObj ? { transport: transportObj } : {}),
        ...(tlsObj ? { tls: tlsObj } : {}),
      };

    case 'VLESS':
      return {
        type: 'vless',
        tag: name,
        server: host,
        server_port: port,
        uuid: creds.uuid ?? '',
        ...(tls === 'REALITY' ? { flow: REALITY_FLOW } : {}),
        ...(transportObj ? { transport: transportObj } : {}),
        ...(tlsObj ? { tls: tlsObj } : {}),
      };

    case 'TROJAN':
      return {
        type: 'trojan',
        tag: name,
        server: host,
        server_port: port,
        password: creds.password ?? '',
        ...(transportObj ? { transport: transportObj } : {}),
        ...(tlsObj ? { tls: tlsObj } : { tls: { enabled: true } }),
      };

    case 'SHADOWSOCKS':
      return {
        type: 'shadowsocks',
        tag: name,
        server: host,
        server_port: port,
        method: creds.method ?? 'aes-256-gcm',
        password: creds.password ?? '',
      };

    case 'SOCKS5': {
      const out: Record<string, unknown> = {
        type: 'socks',
        tag: name,
        server: host,
        server_port: port,
        version: '5',
      };
      if (creds.username) out.username = creds.username;
      if (creds.password) out.password = creds.password;
      return out;
    }

    case 'HYSTERIA2':
      return {
        type: 'hysteria2',
        tag: name,
        server: host,
        server_port: port,
        password: creds.password ?? '',
        tls: { enabled: true, insecure: true, ...(domain ? { server_name: domain } : {}) },
      };

    case 'TUIC':
      return {
        type: 'tuic',
        tag: name,
        server: host,
        server_port: port,
        uuid: creds.uuid ?? '',
        password: creds.password ?? '',
        congestion_control: 'bbr',
        udp_relay_mode: 'native',
        zero_rtt_handshake: false,
        tls: buildVerifiedSingboxTls(domain),
      };

    case 'ANYTLS':
      return {
        type: 'anytls',
        tag: name,
        server: host,
        server_port: port,
        password: creds.password ?? '',
        tls: buildVerifiedSingboxTls(domain),
      };

    case 'HTTP':
      return {
        type: 'http',
        tag: name,
        server: host,
        server_port: port,
        ...(creds.username ? { username: creds.username, password: creds.password ?? '' } : {}),
      };

    default:
      return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toClashNet(transport: string | null): string {
  const map: Record<string, string> = { WS: 'ws', GRPC: 'grpc', QUIC: 'quic', TCP: 'tcp', XHTTP: 'xhttp' };
  return map[transport ?? 'TCP'] ?? 'tcp';
}

function formatUriHost(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host;
  return host.includes(':') ? `[${host}]` : host;
}

function addTransportParams(
  params: URLSearchParams,
  net: string,
  domain: string | null,
  creds: Record<string, string>,
) {
  params.set('type', net);
  if (net === 'ws') {
    params.set('path', '/');
    if (domain) params.set('host', domain);
  } else if (net === 'grpc') {
    params.set('serviceName', 'grpc');
  } else if (net === 'xhttp') {
    params.set('path', normalizeXhttpPath(creds.path));
    const xhttpHost = parseXhttpHost(creds.xhttpHost);
    if (xhttpHost) params.set('host', xhttpHost);
    params.set('mode', requireXhttpMode(creds.xhttpMode));
    if (creds.xhttpExtra !== undefined) {
      parseXhttpExtra(creds.xhttpExtra);
      params.set('extra', creds.xhttpExtra);
    }
  }
}

function addTlsParams(
  params: URLSearchParams,
  tls: string,
  domain: string | null,
  creds: Record<string, string>,
) {
  if (tls === 'TLS') {
    params.set('security', 'tls');
    if (domain) params.set('sni', domain);
  } else if (tls === 'REALITY') {
    params.set('security', 'reality');
    params.set('pbk', creds.realityPublicKey ?? '');
    params.set('sid', creds.shortId ?? '');
    params.set('fp', 'chrome');
    // sni must match serverNames in the Xray server config; default to www.google.com
    params.set('sni', domain ?? REALITY_DEFAULT_SNI);
  } else {
    params.set('security', 'none');
  }
}

function buildVerifiedSingboxTls(domain: string | null): Record<string, unknown> {
  return {
    enabled: true,
    insecure: false,
    ...(domain ? { server_name: domain } : {}),
  };
}

function normalizeXhttpPath(path: string | undefined): string {
  const normalized = path?.trim() || '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function requireXhttpMode(mode: string | undefined): string {
  const parsed = parseXhttpMode(mode);
  if (!parsed) throw new Error(`Unsupported XHTTP mode: ${mode}`);
  return parsed;
}

function addClashXhttpOptions(
  lines: string[],
  creds: Record<string, string>,
): void {
  const mode = requireXhttpMode(creds.xhttpMode);
  const xhttpHost = parseXhttpHost(creds.xhttpHost);
  lines.push(`    xhttp-opts:`);
  lines.push(`      path: ${yamlScalar(normalizeXhttpPath(creds.path))}`);
  if (xhttpHost) lines.push(`      host: ${yamlScalar(xhttpHost)}`);
  lines.push(`      mode: ${yamlScalar(mode)}`);

  const extra = parseXhttpExtra(creds.xhttpExtra);
  if (extra) appendClashYamlObject(lines, mapXhttpExtraForMihomo(extra), 6);
}

function mapXhttpExtraForMihomo(extra: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const scalarFields: Record<string, string> = {
    noGRPCHeader: 'no-grpc-header',
    xPaddingBytes: 'x-padding-bytes',
    xPaddingObfsMode: 'x-padding-obfs-mode',
    xPaddingKey: 'x-padding-key',
    xPaddingHeader: 'x-padding-header',
    xPaddingPlacement: 'x-padding-placement',
    xPaddingMethod: 'x-padding-method',
    uplinkHttpMethod: 'uplink-http-method',
    sessionIDPlacement: 'session-placement',
    sessionPlacement: 'session-placement',
    sessionIDKey: 'session-key',
    sessionKey: 'session-key',
    sessionIDTable: 'session-table',
    sessionIDLength: 'session-length',
    seqPlacement: 'seq-placement',
    seqKey: 'seq-key',
    uplinkDataPlacement: 'uplink-data-placement',
    uplinkDataKey: 'uplink-data-key',
    uplinkChunkSize: 'uplink-chunk-size',
    scMaxEachPostBytes: 'sc-max-each-post-bytes',
    scMinPostsIntervalMs: 'sc-min-posts-interval-ms',
  };
  const supported = new Set([...Object.keys(scalarFields), 'xmux', 'downloadSettings']);
  const unknown = Object.keys(extra).filter((key) => !supported.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unsupported Mihomo XHTTP extra fields: ${unknown.join(', ')}`);
  }

  for (const [source, target] of Object.entries(scalarFields)) {
    const value = extra[source];
    if (value !== undefined && value !== '') mapped[target] = value;
  }

  const reuse = mapXhttpReuseSettings(asObject(extra.xmux));
  if (Object.keys(reuse).length > 0) mapped['reuse-settings'] = reuse;

  const download = mapXhttpDownloadSettings(asObject(extra.downloadSettings));
  if (Object.keys(download).length > 0) mapped['download-settings'] = download;
  return mapped;
}

function mapXhttpReuseSettings(xmux: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const fields: Record<string, string> = {
    maxConnections: 'max-connections',
    maxConcurrency: 'max-concurrency',
    cMaxReuseTimes: 'c-max-reuse-times',
    hMaxRequestTimes: 'h-max-request-times',
    hMaxReusableSecs: 'h-max-reusable-secs',
    hKeepAlivePeriod: 'h-keep-alive-period',
  };
  for (const [source, target] of Object.entries(fields)) {
    const value = xmux[source];
    if (value !== undefined && value !== '') mapped[target] = value;
  }
  return mapped;
}

function mapXhttpDownloadSettings(settings: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(settings).length === 0) return {};
  const mapped: Record<string, unknown> = {};
  if (typeof settings.address === 'string' && settings.address) mapped.server = settings.address;
  if (typeof settings.port === 'number') mapped.port = settings.port;
  const security = typeof settings.security === 'string' ? settings.security.toLowerCase() : '';
  if (security === 'tls' || security === 'reality') mapped.tls = true;

  const tlsSettings = asObject(settings.tlsSettings);
  if (typeof tlsSettings.serverName === 'string' && tlsSettings.serverName) {
    mapped.servername = tlsSettings.serverName;
  }
  if (typeof tlsSettings.fingerprint === 'string' && tlsSettings.fingerprint) {
    mapped['client-fingerprint'] = tlsSettings.fingerprint;
  }
  if (Array.isArray(tlsSettings.alpn)) mapped.alpn = tlsSettings.alpn;
  if (tlsSettings.allowInsecure === true) mapped['skip-cert-verify'] = true;

  if (security === 'reality') {
    const reality = asObject(settings.realitySettings);
    const realityOpts: Record<string, unknown> = {};
    if (typeof reality.publicKey === 'string' && reality.publicKey) {
      realityOpts['public-key'] = reality.publicKey;
    }
    if (typeof reality.shortId === 'string' && reality.shortId) {
      realityOpts['short-id'] = reality.shortId;
    }
    if (Object.keys(realityOpts).length > 0) mapped['reality-opts'] = realityOpts;
  }

  const xhttp = asObject(settings.xhttpSettings);
  for (const key of ['path', 'host'] as const) {
    if (typeof xhttp[key] === 'string' && xhttp[key]) mapped[key] = xhttp[key];
  }
  if (asObject(xhttp.headers) && Object.keys(asObject(xhttp.headers)).length > 0) {
    mapped.headers = asObject(xhttp.headers);
  }
  const nestedReuse = mapXhttpReuseSettings(asObject(asObject(xhttp.extra).xmux));
  if (Object.keys(nestedReuse).length > 0) mapped['reuse-settings'] = nestedReuse;
  return mapped;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function appendClashYamlObject(
  lines: string[],
  value: Record<string, unknown>,
  indent: number,
  skip = new Set<string>(),
): void {
  const prefix = ' '.repeat(indent);
  for (const [rawKey, item] of Object.entries(value)) {
    if (skip.has(rawKey)) continue;
    const key = rawKey.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
      throw new Error(`Invalid Mihomo XHTTP option key: ${rawKey}`);
    }
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      lines.push(`${prefix}${key}:`);
      appendClashYamlObject(lines, item as Record<string, unknown>, indent + 2);
    } else if (Array.isArray(item)) {
      lines.push(`${prefix}${key}: ${JSON.stringify(item)}`);
    } else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      lines.push(`${prefix}${key}: ${yamlScalar(item)}`);
    } else if (item === null) {
      lines.push(`${prefix}${key}: null`);
    }
  }
}

function buildSingboxTls(
  tls: string,
  domain: string | null,
  creds: Record<string, string>,
): Record<string, unknown> | null {
  if (tls === 'TLS') {
    return { enabled: true, ...(domain ? { server_name: domain } : {}) };
  }
  if (tls === 'REALITY') {
    return {
      enabled: true,
      server_name: domain ?? REALITY_DEFAULT_SNI,
      reality: {
        enabled: true,
        public_key: creds.realityPublicKey ?? '',
        short_id: creds.shortId ?? '',
      },
      utls: { enabled: true, fingerprint: 'chrome' },
    };
  }
  return null;
}

function buildSingboxTransport(transport: string | null): Record<string, unknown> | null {
  switch (transport) {
    case 'WS':
      return { type: 'ws', path: '/' };
    case 'GRPC':
      return { type: 'grpc', service_name: 'grpc' };
    case 'QUIC':
      return { type: 'quic' };
    default:
      return null;
  }
}

/** Escape a scalar value for YAML (quote strings with special characters). */
function yamlScalar(v: string | number | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === '') return '""';
  // Quote if contains YAML special characters
  if (/[\u0000-\u001f\u007f]|[:{}\[\],#&*?|<>=!%@`'"\\]/.test(v) || /^\s|\s$/.test(v)) {
    return JSON.stringify(v);
  }
  return v;
}

function yamlQuotedString(value: string): string {
  return JSON.stringify(value);
}

// ─── Full Sing-box subscription JSON ─────────────────────────────────────────

export function buildFullSingboxConfig(nodes: NodeExportInfo[]): string {
  const outbounds = nodes
    .map((n) => buildSingboxOutbound(n))
    .filter((o): o is Record<string, unknown> => o !== null);

  assertNoUnsupportedOnlySubscription(nodes, outbounds);

  const proxyTags = outbounds.map((o) => o.tag as string);

  const config = {
    log: { level: 'info' },
    dns: {
      servers: [
        {
          type: 'https',
          tag: 'proxy-dns',
          server: '8.8.8.8',
          tls: { enabled: true, server_name: 'dns.google' },
          detour: '🚀 节点选择',
        },
        {
          type: 'https',
          tag: 'direct-dns',
          server: '223.5.5.5',
          tls: { enabled: true, server_name: 'dns.alidns.com' },
          detour: 'direct',
        },
      ],
      rules: [
        { rule_set: ['geosite-category-ads-all'], action: 'predefined', rcode: 'NOERROR' },
        { rule_set: ['geosite-cn'], action: 'route', server: 'direct-dns' },
      ],
      final: 'proxy-dns',
      strategy: 'prefer_ipv4',
    },
    outbounds: [
      ...outbounds,
      {
        type: 'urltest',
        tag: '⚡ 自动选择',
        outbounds: proxyTags.length > 0 ? proxyTags : ['direct'],
        url: 'http://www.gstatic.com/generate_204',
        interval: '5m',
      },
      {
        type: 'selector',
        tag: '🚀 节点选择',
        outbounds: proxyTags.length > 0 ? ['⚡ 自动选择', ...proxyTags] : ['direct'],
        // default must be one of the listed outbounds; with no nodes the only
        // option is 'direct', otherwise sing-box rejects the config.
        default: proxyTags.length > 0 ? '⚡ 自动选择' : 'direct',
      },
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      default_domain_resolver: { server: 'direct-dns', strategy: 'prefer_ipv4' },
      rule_set: [
        { tag: 'geosite-cn', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs' },
        { tag: 'geoip-cn', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs' },
        { tag: 'geosite-category-ads-all', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs' },
      ],
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        { rule_set: ['geosite-category-ads-all'], action: 'reject' },
        { rule_set: ['geosite-cn'], action: 'route', outbound: 'direct' },
        { rule_set: ['geoip-cn'], action: 'route', outbound: 'direct' },
        { ip_is_private: true, action: 'route', outbound: 'direct' },
      ],
      final: '🚀 节点选择',
      auto_detect_interface: true,
    },
  };

  return JSON.stringify(config, null, 2);
}

// ─── AI Service Domains (inline routing rules) ───────────────────────────────

/**
 * Domain suffix patterns — one entry covers ALL subdomains of a vendor's
 * dedicated domain (e.g. "openai.com" matches api.openai.com, sora.openai.com …).
 * Update this list when new major AI services or domains emerge.
 */
const AI_DOMAIN_SUFFIX: string[] = [
  // OpenAI ecosystem
  'openai.com', 'chatgpt.com', 'oaiusercontent.com', 'oaistatic.com', 'sora.com',
  // Anthropic / Claude
  'anthropic.com', 'claude.ai', 'claudeusercontent.com',
  // Perplexity
  'perplexity.ai',
  // Midjourney
  'midjourney.com',
  // Hugging Face
  'huggingface.co', 'hf.co',
  // Groq
  'groq.com',
  // Together AI
  'together.ai',
  // xAI / Grok
  'x.ai',
  // Mistral AI
  'mistral.ai',
  // Cohere
  'cohere.com', 'cohere.ai',
  // Stability AI
  'stability.ai',
  // ElevenLabs
  'elevenlabs.io',
  // Replicate
  'replicate.com', 'replicate.delivery',
  // Character.AI
  'character.ai', 'c.ai',
  // Poe
  'poe.com',
  // Runway ML
  'runwayml.com',
  // Fireworks AI
  'fireworks.ai',
  // DeepSeek (international API)
  'deepseek.com',
  // Inflection AI (Pi)
  'inflection.ai', 'pi.ai',
  // AI21 Labs
  'ai21.com',
  // Aleph Alpha
  'aleph-alpha.com',
  // Modal
  'modal.com',
  // Moonshot AI / Kimi (international access)
  'moonshot.ai', 'kimi.ai',
];

/**
 * Exact domain matches — for AI services that share infrastructure domains
 * with non-AI products (e.g. googleapis.com, microsoft.com).
 * Must be precise to avoid unintentionally proxying unrelated traffic.
 */
const AI_DOMAIN_EXACT: string[] = [
  // Google Gemini API (shares googleapis.com with all Google services)
  'generativelanguage.googleapis.com',
  'aistudio.google.com',
  'makersuite.google.com',
  // Microsoft Copilot (shares microsoft.com / bing.com)
  'copilot.microsoft.com',
  'sydney.bing.com',
  'edgeservices.bing.com',
  'copilot.bing.com',
];

// ─── Remote rule_set definitions (jsDelivr CDN — accessible in China) ────────

const CDN = 'https://cdn.jsdelivr.net/gh';

const HOMEPROXY_RULE_SETS = [
  { tag: 'geosite-cn',               url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-cn.srs` },
  { tag: 'geoip-cn',                 url: `${CDN}/SagerNet/sing-geoip@rule-set/geoip-cn.srs` },
  { tag: 'geosite-category-ads-all', url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-category-ads-all.srs` },
  { tag: 'geosite-netflix',          url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-netflix.srs` },
  { tag: 'geosite-youtube',          url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-youtube.srs` },
  { tag: 'geosite-disneyplus',       url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-disneyplus.srs` },
] as const;

// ─── HomeProxy / OpenWrt router sing-box config ───────────────────────────────

/**
 * Generates a complete sing-box JSON configuration for router-level transparent
 * proxy via HomeProxy on OpenWrt. Includes:
 *   - tproxy inbound (port 7895) for iptables-based traffic interception
 *   - mixed inbound (port 7890) for HTTP/SOCKS5
 *   - Full routing: ads block → AI services → streaming → CN direct → proxy
 *   - Split DNS: CN domains → 223.5.5.5 direct, others → 1.1.1.1 via proxy
 *   - Remote rule_sets via jsDelivr CDN (auto-update daily)
 *   - Inline AI service rules (domain_suffix + exact domain)
 */
export function buildHomeProxyConfig(nodes: NodeExportInfo[]): string {
  const outbounds = nodes
    .map((n) => buildSingboxOutbound(n))
    .filter((o): o is Record<string, unknown> => o !== null);

  assertNoUnsupportedOnlySubscription(nodes, outbounds);

  const proxyTags = outbounds.map((o) => o.tag as string);
  const hasNodes = proxyTags.length > 0;
  const fallback = hasNodes ? proxyTags : ['direct'];

  const config = {
    log: { level: 'warn', timestamp: true },

    dns: {
      servers: [
        // Resolver for bootstrap (no detour — prevents circular dependency)
        { type: 'udp', tag: 'dns-local', server: '223.5.5.5', detour: 'direct' },
        // CN domains: DoH via Alibaba, always direct
        {
          type: 'https',
          tag: 'dns-direct',
          server: '223.5.5.5',
          tls: { enabled: true, server_name: 'dns.alidns.com' },
          detour: 'direct',
        },
        // Foreign domains: DNS over TLS via 1.1.1.1, routed through proxy
        {
          type: 'tls',
          tag: 'dns-proxy',
          server: '1.1.1.1',
          tls: { enabled: true, server_name: 'cloudflare-dns.com' },
          detour: '🚀 节点选择',
        },
      ],
      rules: [
        // Block ads at DNS level
        { rule_set: ['geosite-category-ads-all'], action: 'predefined', rcode: 'REFUSED' },
        // CN domains use domestic DNS
        { rule_set: ['geosite-cn'], action: 'route', server: 'dns-direct' },
      ],
      final: 'dns-proxy',
      strategy: 'prefer_ipv4',
    },

    inbounds: [
      {
        // Transparent proxy — receives traffic redirected by iptables/nftables
        type: 'tproxy',
        tag: 'tproxy-in',
        listen: '::',
        listen_port: 7895,
      },
      {
        // HTTP/SOCKS5 proxy for devices that don't support tproxy
        type: 'mixed',
        tag: 'mixed-in',
        listen: '::',
        listen_port: 7890,
      },
    ],

    outbounds: [
      ...outbounds,
      {
        type: 'urltest',
        tag: '⚡ 自动选择',
        outbounds: fallback,
        url: 'https://www.gstatic.com/generate_204',
        interval: '5m',
        tolerance: 50,
      },
      {
        type: 'selector',
        tag: '🚀 节点选择',
        outbounds: hasNodes ? ['⚡ 自动选择', ...proxyTags] : ['direct'],
        default: hasNodes ? '⚡ 自动选择' : 'direct',
      },
      {
        type: 'selector',
        tag: '🎬 流媒体',
        outbounds: hasNodes ? ['🚀 节点选择', '⚡ 自动选择', ...proxyTags] : ['direct'],
        default: hasNodes ? '🚀 节点选择' : 'direct',
      },
      {
        type: 'selector',
        tag: '🤖 AI 服务',
        outbounds: hasNodes ? ['🚀 节点选择', '⚡ 自动选择', ...proxyTags] : ['direct'],
        default: hasNodes ? '🚀 节点选择' : 'direct',
      },
      { type: 'direct', tag: 'direct' },
    ],

    route: {
      rules: [
        // Replaces the removed per-inbound domain_strategy and sniff fields.
        { inbound: ['tproxy-in', 'mixed-in'], action: 'resolve', strategy: 'prefer_ipv4' },
        { inbound: ['tproxy-in', 'mixed-in'], action: 'sniff' },
        // DNS traffic is handled by the built-in DNS module.
        { protocol: 'dns', action: 'hijack-dns' },
        // LAN / private IPs always go direct
        { ip_is_private: true, action: 'route', outbound: 'direct' },
        // Block ads
        { rule_set: ['geosite-category-ads-all'], action: 'reject' },
        // AI services — inline domain rules (no external rule_set file needed)
        {
          domain_suffix: AI_DOMAIN_SUFFIX,
          domain: AI_DOMAIN_EXACT,
          action: 'route',
          outbound: '🤖 AI 服务',
        },
        // Streaming services
        {
          rule_set: ['geosite-netflix', 'geosite-youtube', 'geosite-disneyplus'],
          action: 'route',
          outbound: '🎬 流媒体',
        },
        // China domains and IPs — direct
        { rule_set: ['geosite-cn', 'geoip-cn'], action: 'route', outbound: 'direct' },
      ],
      rule_set: HOMEPROXY_RULE_SETS.map((rs) => ({
        tag: rs.tag,
        type: 'remote',
        format: 'binary',
        url: rs.url,
        download_detour: 'direct',
        update_interval: '1d',
      })),
      final: '🚀 节点选择',
      default_domain_resolver: { server: 'dns-local', strategy: 'prefer_ipv4' },
      auto_detect_interface: true,
    },
  };

  return JSON.stringify(config, null, 2);
}

function assertNoUnsupportedOnlySubscription(
  nodes: NodeExportInfo[],
  outbounds: Record<string, unknown>[],
): void {
  if (nodes.length > 0 && outbounds.length === 0) {
    throw new Error('sing-box does not support XHTTP; use the Mihomo subscription');
  }
}

// ─── Hiddify deep link ──────────────────────────────────────────────────────

/** Build Hiddify deep link from a subscription URL */
export function buildHiddifyDeepLink(subscriptionUrl: string): string {
  return `hiddify://import/${subscriptionUrl}`;
}

// ─── Full Clash / Mihomo subscription YAML ───────────────────────────────────

const RULE_NAMES = ['reject', 'proxy', 'direct', 'cncidr', 'telegramcidr', 'netflix', 'youtube', 'apple', 'microsoft', 'openai'] as const;

const RULE_BEHAVIOR: Record<typeof RULE_NAMES[number], string> = {
  reject: 'domain',
  proxy: 'domain',
  direct: 'domain',
  cncidr: 'ipcidr',
  telegramcidr: 'ipcidr',
  netflix: 'classical',
  youtube: 'classical',
  apple: 'classical',
  microsoft: 'classical',
  openai: 'classical',
};

export function buildClashSubscription(nodes: NodeExportInfo[], panelUrl: string): string {
  const proxyEntries: { name: string; yaml: string }[] = [];
  for (const node of nodes) {
    const yaml = buildClashProxy(node);
    if (yaml !== null) proxyEntries.push({ name: node.name, yaml });
  }
  if (nodes.length > 0 && proxyEntries.length === 0) {
    throw new Error('Mihomo supports XHTTP only with VLESS; no compatible nodes remain');
  }

  const nodeNames = proxyEntries.map((e) => e.name);
  // url-test 至少需要 1 个 proxy；无可用节点时回退到 DIRECT，避免 YAML 解析失败
  const fallbackNames = nodeNames.length > 0 ? nodeNames : ['DIRECT'];

  // ── rule-providers ────────────────────────────────────────────────────────
  const base = panelUrl.replace(/\/$/, '');
  const ruleProviderLines: string[] = ['rule-providers:'];
  for (const name of RULE_NAMES) {
    ruleProviderLines.push(
      `  ${name}:`,
      `    type: http`,
      `    behavior: ${RULE_BEHAVIOR[name]}`,
      `    url: "${base}/api/rules/${name}"`,
      `    interval: 86400`,
    );
  }

  // ── proxies ───────────────────────────────────────────────────────────────
  const proxiesSection =
    proxyEntries.length === 0
      ? 'proxies: []'
      : ['proxies:', ...proxyEntries.map((e) => e.yaml)].join('\n');

  // ── proxy-groups ──────────────────────────────────────────────────────────
  function nodeList(prefix: string[] = [], names: string[] = fallbackNames): string {
    return [...prefix, ...names].map((n) => `      - ${yamlScalar(n)}`).join('\n');
  }

  const groups: string[] = [
    [
      '  - name: 🚀 节点选择',
      '    type: select',
      '    proxies:',
      nodeList(['⚡ 自动选择']),
    ].join('\n'),
    [
      '  - name: ⚡ 自动选择',
      '    type: url-test',
      '    url: http://www.gstatic.com/generate_204',
      '    interval: 300',
      '    proxies:',
      nodeList(),
    ].join('\n'),
    ...([
      ['🎬 流媒体', '🚀 节点选择'],
      ['🤖 AI 服务', '🚀 节点选择'],
      ['📱 Telegram', '🚀 节点选择'],
    ] as [string, string][]).map(([groupName, def]) =>
      [
        `  - name: ${groupName}`,
        '    type: select',
        '    proxies:',
        nodeList([def]),
      ].join('\n'),
    ),
    ...([
      ['🍎 Apple', 'DIRECT'],
      ['🪟 Microsoft', 'DIRECT'],
    ] as [string, string][]).map(([groupName, def]) =>
      [
        `  - name: ${groupName}`,
        '    type: select',
        '    proxies:',
        nodeList([def, '🚀 节点选择']),
      ].join('\n'),
    ),
    [
      '  - name: 🐟 漏网之鱼',
      '    type: select',
      '    proxies:',
      nodeList(['🚀 节点选择', 'DIRECT']),
    ].join('\n'),
  ];

  const proxyGroupsSection = ['proxy-groups:', ...groups].join('\n');

  // ── rules ─────────────────────────────────────────────────────────────────
  const rulesSection = [
    'rules:',
    '  - RULE-SET,reject,REJECT',
    '  - RULE-SET,netflix,🎬 流媒体',
    '  - RULE-SET,youtube,🎬 流媒体',
    '  - RULE-SET,apple,🍎 Apple',
    '  - RULE-SET,microsoft,🪟 Microsoft',
    '  - RULE-SET,telegramcidr,📱 Telegram',
    '  - RULE-SET,openai,🤖 AI 服务',
    '  - RULE-SET,proxy,🚀 节点选择',
    '  - RULE-SET,direct,DIRECT',
    '  - RULE-SET,cncidr,DIRECT',
    '  - GEOIP,LAN,DIRECT',
    '  - GEOIP,CN,DIRECT',
    '  - MATCH,🐟 漏网之鱼',
  ].join('\n');

  // ── top-level config ──────────────────────────────────────────────────────
  const topLevel = [
    'mixed-port: 7890',
    'allow-lan: false',
    'mode: rule',
    'log-level: info',
    'ipv6: false',
    'external-controller: 127.0.0.1:9090',
  ].join('\n');

  return [
    topLevel,
    '',
    ruleProviderLines.join('\n'),
    '',
    proxiesSection,
    '',
    proxyGroupsSection,
    '',
    rulesSection,
    '',
  ].join('\n');
}
