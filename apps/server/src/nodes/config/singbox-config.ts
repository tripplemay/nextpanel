import type { NodeInfo, NodeCredentials } from './config-generator';

// ─── sing-box ────────────────────────────────────────────────────────────────

export function generateSingBoxConfig(node: NodeInfo, creds: NodeCredentials): string {
  return JSON.stringify(
    {
      log: { level: 'warn' },
      inbounds: [singBoxInbound(node, creds)],
      outbounds: [{ type: 'direct', tag: 'direct' }],
    },
    null,
    2,
  );
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
  }

  if (node.transport === 'WS') {
    base.transport = { type: 'ws', path: '/' };
  } else if (node.transport === 'GRPC') {
    base.transport = { type: 'grpc', service_name: 'grpc' };
  }

  if (node.tls === 'TLS') {
    base.tls = { enabled: true, server_name: node.domain ?? '', certificate_path: '', key_path: '' };
  } else if (node.tls === 'REALITY') {
    base.tls = {
      enabled: true,
      reality: {
        enabled: true,
        handshake: { server: node.domain ?? 'www.google.com', server_port: 443 },
        private_key: '',
        short_id: [''],
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
  };
  return map[protocol] ?? protocol.toLowerCase();
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
