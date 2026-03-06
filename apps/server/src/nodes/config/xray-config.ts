import type { NodeInfo, NodeCredentials } from './config-generator';
import { REALITY_DEFAULT_SNI, REALITY_FLOW } from '../protocols/reality';

// ─── Xray / V2Ray ────────────────────────────────────────────────────────────

export function generateXrayConfig(node: NodeInfo, creds: NodeCredentials): string {
  const proxyInbound = {
    tag: `in-${node.id}`,
    port: node.listenPort,
    listen: '0.0.0.0',
    protocol: xrayProtocol(node.protocol),
    settings: xraySettings(node.protocol, creds, node.tls),
    streamSettings: xrayStreamSettings(node.id, node.transport, node.tls, node.domain, creds),
  };

  if (node.statsPort) {
    return JSON.stringify(
      {
        log: { loglevel: 'warning' },
        stats: {},
        api: { tag: 'api', services: ['StatsService'] },
        policy: { system: { statsInboundUplink: true, statsInboundDownlink: true } },
        inbounds: [
          {
            tag: 'api',
            listen: '127.0.0.1',
            port: node.statsPort,
            protocol: 'dokodemo-door',
            settings: { address: '127.0.0.1' },
          },
          proxyInbound,
        ],
        outbounds: [{ protocol: 'freedom', tag: 'direct' }],
        routing: {
          rules: [{ type: 'field', inboundTag: ['api'], outboundTag: 'api' }],
        },
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      log: { loglevel: 'warning' },
      inbounds: [proxyInbound],
      outbounds: [{ protocol: 'freedom', tag: 'direct' }],
    },
    null,
    2,
  );
}

function xrayProtocol(protocol: string): string {
  const map: Record<string, string> = {
    VMESS: 'vmess',
    VLESS: 'vless',
    TROJAN: 'trojan',
    SHADOWSOCKS: 'shadowsocks',
    SOCKS5: 'socks',
    HTTP: 'http',
  };
  return map[protocol] ?? protocol.toLowerCase();
}

function xraySettings(protocol: string, creds: NodeCredentials, tls?: string): unknown {
  switch (protocol) {
    case 'VMESS':
      return { clients: [{ id: creds.uuid ?? '', alterId: 0 }] };
    case 'VLESS':
      return {
        clients: [{ id: creds.uuid ?? '', flow: tls === 'REALITY' ? REALITY_FLOW : '' }],
        decryption: 'none',
      };
    case 'TROJAN':
      return { clients: [{ password: creds.password ?? '' }] };
    case 'SHADOWSOCKS':
      return {
        method: creds.method ?? 'aes-256-gcm',
        password: creds.password ?? '',
        network: 'tcp,udp',
      };
    case 'SOCKS5':
      return {
        auth: creds.username ? 'password' : 'noauth',
        accounts: creds.username
          ? [{ user: creds.username, pass: creds.password ?? '' }]
          : [],
        udp: true,
      };
    case 'HTTP':
      return {
        accounts: creds.username
          ? [{ user: creds.username, pass: creds.password ?? '' }]
          : [],
      };
    default:
      return {};
  }
}

function xrayStreamSettings(
  nodeId: string,
  transport: string | null,
  tls: string,
  domain: string | null,
  creds: NodeCredentials,
): unknown {
  const network = transportNetwork(transport);
  const base: Record<string, unknown> = { network };

  if (network === 'ws') {
    base.wsSettings = { path: '/' };
  } else if (network === 'grpc') {
    base.grpcSettings = { serviceName: 'grpc' };
  }

  if (tls === 'TLS') {
    base.security = 'tls';
    base.tlsSettings = {
      serverName: domain ?? '',
      certificates: [
        {
          certificateFile: `/etc/nextpanel/certs/${nodeId}.crt`,
          keyFile: `/etc/nextpanel/certs/${nodeId}.key`,
        },
      ],
    };
  } else if (tls === 'REALITY') {
    base.security = 'reality';
    base.realitySettings = {
      dest: `${domain ?? REALITY_DEFAULT_SNI}:443`,
      serverNames: [domain ?? REALITY_DEFAULT_SNI],
      privateKey: creds.realityPrivateKey ?? '',
      shortIds: [''],
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
  };
  if (transport === 'QUIC') {
    throw new Error(
      'QUIC transport was removed in Xray 26.x. Change the node transport to TCP, WS, or GRPC.',
    );
  }
  return map[transport ?? 'TCP'] ?? 'tcp';
}
