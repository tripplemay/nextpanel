import type { NodeInfo, NodeCredentials } from './config-generator';
import { REALITY_DEFAULT_SNI, REALITY_FLOW } from '../protocols/reality';

// ─── Xray / V2Ray ────────────────────────────────────────────────────────────

export function generateXrayConfig(node: NodeInfo, creds: NodeCredentials): string {
  const proxyInbound = {
    tag: `in-${node.id}`,
    port: node.listenPort,
    listen: '::',
    protocol: xrayProtocol(node.protocol),
    settings: xraySettings(node.protocol, creds, node.tls, node.transport),
    streamSettings: xrayStreamSettings(node.id, node.transport, node.tls, node.domain, creds),
  };

  // Determine outbound: chain exit or direct freedom
  const isChain = !!(node.chainExitIp && node.chainExitPort && node.chainUuid);
  const chainReality = isChain ? getChainRealityClient(node) : null;
  const outbounds: unknown[] = isChain
    ? [
        {
          protocol: 'vless',
          tag: 'chain-exit',
          settings: {
            vnext: [{
              address: node.chainExitIp,
              port: node.chainExitPort,
              users: [{ id: node.chainUuid, encryption: 'none' }],
            }],
          },
          streamSettings: {
            network: 'tcp',
            security: chainReality ? 'reality' : 'none',
            ...(chainReality
              ? {
                  realitySettings: {
                    serverName: REALITY_DEFAULT_SNI,
                    fingerprint: 'chrome',
                    password: chainReality.publicKey,
                    shortId: chainReality.shortId,
                  },
                }
              : {}),
            sockopt: { tcpKeepAliveInterval: 30 },
          },
          ...(chainReality
            ? {
                mux: {
                  enabled: true,
                  concurrency: 8,
                  xudpConcurrency: 16,
                  xudpProxyUDP443: 'allow',
                },
              }
            : {}),
        },
      ]
    : [{ protocol: 'freedom', tag: 'direct' }];

  if (node.statsPort) {
    const routingRules: unknown[] = [
      { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
    ];
    if (isChain) {
      routingRules.push({ type: 'field', inboundTag: [`in-${node.id}`], outboundTag: 'chain-exit' });
    }

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
        outbounds: outbounds,
        routing: {
          rules: routingRules,
        },
      },
      null,
      2,
    );
  }

  const config: Record<string, unknown> = {
    log: { loglevel: 'warning' },
    inbounds: [proxyInbound],
    outbounds: outbounds,
  };

  if (isChain) {
    config.routing = {
      rules: [{ type: 'field', inboundTag: [`in-${node.id}`], outboundTag: 'chain-exit' }],
    };
  }

  return JSON.stringify(config, null, 2);
}

function getChainRealityClient(
  node: NodeInfo,
): { publicKey: string; shortId: string } | null {
  const values = [
    node.chainRealityPrivateKey,
    node.chainRealityPublicKey,
    node.chainShortId,
  ];
  const hasAny = values.some((value) => !!value);
  const hasAll = values.every((value) => !!value);
  if (hasAny && !hasAll) {
    throw new Error('Secure chain requires complete REALITY key and short ID credentials');
  }
  return hasAll
    ? { publicKey: node.chainRealityPublicKey!, shortId: node.chainShortId! }
    : null;
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

function xraySettings(
  protocol: string,
  creds: NodeCredentials,
  tls?: string,
  transport?: string | null,
): unknown {
  switch (protocol) {
    case 'VMESS':
      return { clients: [{ id: creds.uuid ?? '', alterId: 0 }] };
    case 'VLESS':
      return {
        clients: [
          {
            id: creds.uuid ?? '',
            flow: tls === 'REALITY' && transport !== 'XHTTP' ? REALITY_FLOW : '',
          },
        ],
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
  } else if (network === 'xhttp') {
    const path = creds.path ?? '/';
    base.xhttpSettings = {
      path: path.startsWith('/') ? path : `/${path}`,
      mode: 'auto',
    };
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
      shortIds: [creds.shortId ?? ''],
    };
  } else {
    base.security = 'none';
  }

  return base;
}

function transportNetwork(transport: string | null): string {
  const map: Record<string, string> = {
    TCP: 'tcp',
    RAW: 'raw',
    WS: 'ws',
    GRPC: 'grpc',
    XHTTP: 'xhttp',
  };
  if (transport === 'QUIC') {
    throw new Error(
      'QUIC transport was removed in Xray 26.x. Change the node transport to TCP, RAW, WS, GRPC, or XHTTP.',
    );
  }
  return map[transport ?? 'TCP'] ?? 'tcp';
}
