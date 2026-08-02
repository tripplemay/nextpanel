/**
 * Build a minimal Xray *client* config for connectivity testing.
 *
 * Inbound  : SOCKS5 on a local port chosen by the caller
 * Outbound : the node's protocol / transport / TLS
 *
 * The caller sends an HTTP request through the SOCKS5 proxy and checks
 * whether http://www.gstatic.com/generate_204 returns 204 — confirming
 * the node can actually proxy traffic through the GFW.
 */

import { REALITY_DEFAULT_SNI, REALITY_FLOW } from '../protocols/reality';
import { parseXhttpExtra, parseXhttpHost, parseXhttpMode } from '../protocols/xhttp';

export interface NodeTestInfo {
  protocol: string;      // VMESS | VLESS | TROJAN | SHADOWSOCKS
  transport: string | null;
  tls: string;           // NONE | TLS | REALITY
  host: string;          // server IP
  port: number;          // listenPort
  domain: string | null; // SNI / REALITY serverName
  credentials: Record<string, string>;
}

export function buildXrayClientConfig(node: NodeTestInfo, localSocksPort: number): string {
  return JSON.stringify(
    {
      log: { loglevel: 'none' },
      inbounds: [
        {
          tag: 'socks-in',
          port: localSocksPort,
          listen: '127.0.0.1',
          protocol: 'socks',
          settings: { udp: true, ip: '127.0.0.1' },
        },
      ],
      outbounds: [
        {
          tag: 'proxy-out',
          protocol: clientProtocol(node.protocol),
          settings: clientSettings(node),
          streamSettings: clientStreamSettings(node),
        },
        { tag: 'direct', protocol: 'freedom' },
      ],
    },
    null,
    2,
  );
}

// ── Protocol name mapping ─────────────────────────────────────────────────────

function clientProtocol(protocol: string): string {
  const map: Record<string, string> = {
    VMESS: 'vmess',
    VLESS: 'vless',
    TROJAN: 'trojan',
    SHADOWSOCKS: 'shadowsocks',
  };
  return map[protocol] ?? protocol.toLowerCase();
}

// ── Outbound settings by protocol ────────────────────────────────────────────

function clientSettings(node: NodeTestInfo): unknown {
  const { protocol, host, port, tls, credentials: c } = node;

  switch (protocol) {
    case 'VMESS':
      return {
        vnext: [
          {
            address: host,
            port,
            users: [{ id: c.uuid ?? '', alterId: 0, security: 'auto' }],
          },
        ],
      };

    case 'VLESS':
      return {
        vnext: [
          {
            address: host,
            port,
            users: [
              {
                id: c.uuid ?? '',
                encryption: 'none',
                // XHTTP multiplexing is incompatible with Vision flow.
                flow: tls === 'REALITY' && node.transport !== 'XHTTP' ? REALITY_FLOW : '',
              },
            ],
          },
        ],
      };

    case 'TROJAN':
      return {
        servers: [{ address: host, port, password: c.password ?? '' }],
      };

    case 'SHADOWSOCKS':
      return {
        servers: [
          {
            address: host,
            port,
            method: c.method ?? 'aes-256-gcm',
            password: c.password ?? '',
          },
        ],
      };

    default:
      return {};
  }
}

// ── Stream settings (transport + TLS) ────────────────────────────────────────

function clientStreamSettings(node: NodeTestInfo): unknown {
  const { transport, tls, domain, credentials: c } = node;
  const network = transportNetwork(transport);
  const base: Record<string, unknown> = { network };

  // Transport-specific settings
  if (network === 'ws') {
    base.wsSettings = { path: '/', headers: domain ? { Host: domain } : {} };
  } else if (network === 'grpc') {
    base.grpcSettings = { serviceName: 'grpc' };
  } else if (network === 'xhttp') {
    const mode = parseXhttpMode(c.xhttpMode);
    if (!mode) throw new Error(`Unsupported XHTTP mode: ${c.xhttpMode}`);
    const xhttpHost = parseXhttpHost(c.xhttpHost);
    const extra = parseXhttpExtra(c.xhttpExtra);
    base.xhttpSettings = {
      path: c.path ?? '/',
      ...(xhttpHost ? { host: xhttpHost } : {}),
      mode,
      ...(extra ? { extra } : {}),
    };
  }

  // TLS / REALITY
  if (tls === 'TLS') {
    base.security = 'tls';
    base.tlsSettings = {
      serverName: domain ?? '',
    };
  } else if (tls === 'REALITY') {
    base.security = 'reality';
    base.realitySettings = {
      serverName: domain ?? REALITY_DEFAULT_SNI,
      fingerprint: 'chrome',
      publicKey: c.realityPublicKey ?? '',
      shortId: c.shortId ?? '',
    };
  } else {
    base.security = 'none';
  }

  return base;
}

function transportNetwork(transport: string | null): string {
  const map: Record<string, string> = {
    TCP: 'tcp',
    WS: 'ws',
    GRPC: 'grpc',
    XHTTP: 'xhttp',
  };
  return map[transport ?? 'TCP'] ?? 'tcp';
}
