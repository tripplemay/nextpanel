import type { NodeInfo, NodeCredentials } from './config-generator';
import { REALITY_DEFAULT_SNI } from '../protocols/reality';

// ─── sing-box ────────────────────────────────────────────────────────────────

export function generateSingBoxConfig(node: NodeInfo, creds: NodeCredentials): string {
  const isChain = !!(node.chainExitIp && node.chainExitPort && node.chainUuid);
  const chainReality = isChain ? getChainRealityClient(node) : null;
  const outbounds: unknown[] = isChain
    ? [
        {
          type: 'vless',
          tag: 'chain-exit',
          server: node.chainExitIp,
          server_port: node.chainExitPort,
          uuid: node.chainUuid,
          packet_encoding: 'xudp',
          ...(chainReality
            ? {
                tls: {
                  enabled: true,
                  server_name: REALITY_DEFAULT_SNI,
                  utls: { enabled: true, fingerprint: 'chrome' },
                  reality: {
                    enabled: true,
                    public_key: chainReality.publicKey,
                    short_id: chainReality.shortId,
                  },
                },
              }
            : {}),
        },
        { type: 'direct', tag: 'direct' },
      ]
    : [{ type: 'direct', tag: 'direct' }];

  const config: Record<string, unknown> = {
    log: { level: 'warn' },
    inbounds: [singBoxInbound(node, creds)],
    outbounds,
  };

  if (isChain) {
    config.route = {
      rules: [
        {
          inbound: [`in-${node.id}`],
          action: 'route',
          outbound: 'chain-exit',
        },
      ],
      final: 'direct',
    };
  }

  return JSON.stringify(
    config,
    null,
    2,
  );
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

function singBoxInbound(node: NodeInfo, creds: NodeCredentials): unknown {
  const base: Record<string, unknown> = {
    type: singBoxType(node.protocol),
    tag: `in-${node.id}`,
    listen: '::',
    listen_port: node.listenPort,
  };

  switch (node.protocol) {
    case 'VMESS':
      base.users = [{ uuid: creds.uuid ?? '', alterId: 0 }];
      break;
    case 'VLESS':
      base.users = [{ uuid: creds.uuid ?? '', flow: '' }];
      break;
    case 'TROJAN':
      base.users = [{ password: creds.password ?? '' }];
      break;
    case 'SHADOWSOCKS':
      base.method = creds.method ?? 'aes-256-gcm';
      base.password = creds.password ?? '';
      break;
    case 'SOCKS5':
      if (creds.username) base.users = [{ username: creds.username, password: creds.password ?? '' }];
      break;
    case 'HTTP':
      if (creds.username) base.users = [{ username: creds.username, password: creds.password ?? '' }];
      break;
    case 'HYSTERIA2':
      base.users = [{ password: creds.password ?? '' }];
      base.tls = certificateTls(node.id);
      break;
    case 'TUIC':
      base.users = [{ uuid: creds.uuid ?? '', password: creds.password ?? '' }];
      base.congestion_control = 'bbr';
      base.zero_rtt_handshake = false;
      base.heartbeat = '10s';
      base.tls = certificateTls(node.id);
      break;
    case 'ANYTLS':
      base.users = [{ password: creds.password ?? '' }];
      base.tls = certificateTls(node.id);
      break;
  }

  if (node.transport === 'WS') {
    base.transport = { type: 'ws', path: '/' };
  } else if (node.transport === 'GRPC') {
    base.transport = { type: 'grpc', service_name: 'grpc' };
  }

  if (node.tls === 'TLS') {
    base.tls = {
      enabled: true,
      server_name: node.domain ?? '',
      certificate_path: `/etc/nextpanel/certs/${node.id}.crt`,
      key_path: `/etc/nextpanel/certs/${node.id}.key`,
    };
  } else if (node.tls === 'REALITY') {
    base.tls = {
      enabled: true,
      reality: {
        enabled: true,
        handshake: { server: node.domain ?? REALITY_DEFAULT_SNI, server_port: 443 },
        private_key: creds.realityPrivateKey ?? '',
        short_id: [creds.shortId ?? ''],
      },
    };
  }

  return base;
}

function singBoxType(protocol: string): string {
  const map: Record<string, string> = {
    VMESS: 'vmess',
    VLESS: 'vless',
    TROJAN: 'trojan',
    SHADOWSOCKS: 'shadowsocks',
    SOCKS5: 'socks',
    HTTP: 'http',
    HYSTERIA2: 'hysteria2',
    TUIC: 'tuic',
    ANYTLS: 'anytls',
  };
  return map[protocol] ?? protocol.toLowerCase();
}

function certificateTls(nodeId: string): Record<string, unknown> {
  return {
    enabled: true,
    certificate_path: `/etc/nextpanel/certs/${nodeId}.crt`,
    key_path: `/etc/nextpanel/certs/${nodeId}.key`,
  };
}

// ─── ss-libev ────────────────────────────────────────────────────────────────

export function generateSsLibevConfig(node: NodeInfo, creds: NodeCredentials): string {
  return JSON.stringify(
    {
      server: '0.0.0.0',
      server_port: node.listenPort,
      password: creds.password ?? '',
      method: creds.method ?? 'aes-256-gcm',
      timeout: 300,
      mode: 'tcp_and_udp',
    },
    null,
    2,
  );
}
