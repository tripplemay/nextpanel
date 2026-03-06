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

// ─── Share URI (vmess://, vless://, etc.) ────────────────────────────────────

export function buildShareUri(node: NodeExportInfo): string | null {
  const { protocol, host, port, name, transport, tls, domain, credentials: creds } = node;
  const tag = encodeURIComponent(name);
  const net = toClashNet(transport);

  switch (protocol) {
    case 'VMESS': {
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
        host: domain ?? '',
        path: net === 'ws' ? '/' : net === 'grpc' ? 'grpc' : '',
        tls: tls === 'TLS' ? 'tls' : tls === 'REALITY' ? 'reality' : '',
        sni: domain ?? '',
      };
      return `vmess://${Buffer.from(JSON.stringify(obj)).toString('base64')}`;
    }

    case 'VLESS': {
      const params = new URLSearchParams({ encryption: 'none' });
      if (tls === 'REALITY') params.set('flow', REALITY_FLOW);
      addTransportParams(params, net, domain);
      addTlsParams(params, tls, domain, creds);
      return `vless://${creds.uuid ?? ''}@${host}:${port}?${params.toString()}#${tag}`;
    }

    case 'TROJAN': {
      const params = new URLSearchParams();
      addTransportParams(params, net, domain);
      addTlsParams(params, tls, domain, creds);
      const qs = params.toString();
      return `trojan://${creds.password ?? ''}@${host}:${port}${qs ? '?' + qs : ''}#${tag}`;
    }

    case 'SHADOWSOCKS': {
      const method = creds.method ?? 'aes-256-gcm';
      const userInfo = Buffer.from(`${method}:${creds.password ?? ''}`).toString('base64');
      return `ss://${userInfo}@${host}:${port}#${tag}`;
    }

    case 'HYSTERIA2': {
      // hy2://password@host:port?sni=domain#name
      const params = new URLSearchParams();
      if (domain) params.set('sni', domain);
      const qs = params.toString();
      return `hy2://${encodeURIComponent(creds.password ?? '')}@${host}:${port}${qs ? '?' + qs : ''}#${tag}`;
    }

    case 'SOCKS5':
      return `socks5://${host}:${port}#${tag}`;

    case 'HTTP':
      return `http://${host}:${port}#${tag}`;

    default:
      return null;
  }
}

// ─── Clash YAML proxy entry ───────────────────────────────────────────────────

export function buildClashProxy(node: NodeExportInfo): string | null {
  const { protocol, host, port, name, transport, tls, domain, credentials: creds } = node;
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
      add('network', net);
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
      }
      if (tls === 'REALITY') {
        lines.push(`    client-fingerprint: chrome`);
        lines.push(`    reality-opts:`);
        lines.push(`      public-key: ${creds.realityPublicKey ?? ''}`);
        lines.push(`      short-id: ""`);
      }
      break;
    }

    case 'VLESS': {
      add('type', 'vless');
      add('server', host);
      add('port', port);
      add('uuid', creds.uuid ?? '');
      add('network', net);
      if (tls === 'REALITY') add('flow', REALITY_FLOW);
      if (tlsEnabled) add('tls', true);
      if (sni) add('servername', sni);
      if (net === 'ws') {
        lines.push(`    ws-opts:`);
        lines.push(`      path: /`);
      } else if (net === 'grpc') {
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: grpc`);
      }
      if (tls === 'REALITY') {
        lines.push(`    client-fingerprint: chrome`);
        lines.push(`    reality-opts:`);
        lines.push(`      public-key: ${creds.realityPublicKey ?? ''}`);
        lines.push(`      short-id: ""`);
      }
      break;
    }

    case 'TROJAN': {
      add('type', 'trojan');
      add('server', host);
      add('port', port);
      add('password', creds.password ?? '');
      if (sni) add('sni', sni);
      add('network', net);
      if (net === 'ws') {
        lines.push(`    ws-opts:`);
        lines.push(`      path: /`);
      } else if (net === 'grpc') {
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: grpc`);
      }
      break;
    }

    case 'SHADOWSOCKS': {
      add('type', 'ss');
      add('server', host);
      add('port', port);
      add('cipher', creds.method ?? 'aes-256-gcm');
      add('password', creds.password ?? '');
      break;
    }

    case 'HYSTERIA2': {
      add('type', 'hysteria2');
      add('server', host);
      add('port', port);
      add('password', creds.password ?? '');
      if (domain) add('sni', domain);
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
        tls: { enabled: true, ...(domain ? { server_name: domain } : {}) },
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
  const map: Record<string, string> = { WS: 'ws', GRPC: 'grpc', QUIC: 'quic', TCP: 'tcp' };
  return map[transport ?? 'TCP'] ?? 'tcp';
}

function addTransportParams(params: URLSearchParams, net: string, domain: string | null) {
  params.set('type', net);
  if (net === 'ws') {
    params.set('path', '/');
    if (domain) params.set('host', domain);
  } else if (net === 'grpc') {
    params.set('serviceName', 'grpc');
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
    params.set('sid', '');
    params.set('fp', 'chrome');
    // sni must match serverNames in the Xray server config; default to www.google.com
    params.set('sni', domain ?? REALITY_DEFAULT_SNI);
  } else {
    params.set('security', 'none');
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
        short_id: '',
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
  if (/[:{}\[\],#&*?|<>=!%@`'"\\]/.test(v) || /^\s|\s$/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}
