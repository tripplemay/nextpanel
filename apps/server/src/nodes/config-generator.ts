/**
 * Pure-function config generators — no IO, no side effects.
 * Returns a JSON string ready to be written to the remote server.
 */

export interface NodeInfo {
  id: string;
  protocol: string;         // VMess | VLESS | TROJAN | SHADOWSOCKS | SOCKS5 | HTTP
  implementation: string | null; // XRAY | V2RAY | SING_BOX | SS_LIBEV | null
  transport: string | null; // TCP | WS | GRPC | QUIC
  tls: string;              // NONE | TLS | REALITY
  listenPort: number;
  domain: string | null;
}

export interface NodeCredentials {
  uuid?: string;
  password?: string;
  method?: string;
  username?: string;
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function generateConfig(node: NodeInfo, creds: NodeCredentials): string {
  const impl = (node.implementation ?? 'XRAY').toUpperCase();
  switch (impl) {
    case 'XRAY':
    case 'V2RAY':
      return generateXrayConfig(node, creds);
    case 'SING_BOX':
      return generateSingBoxConfig(node, creds);
    case 'SS_LIBEV':
      return generateSsLibevConfig(node, creds);
    default:
      return generateXrayConfig(node, creds);
  }
}

/** Returns the binary path and CLI args for starting the service */
export function getBinaryCommand(node: NodeInfo): { bin: string; args: string } {
  const configPath = `/etc/nextpanel/nodes/${node.id}.json`;
  const impl = (node.implementation ?? 'XRAY').toUpperCase();
  switch (impl) {
    case 'V2RAY':
      return { bin: '/usr/local/bin/v2ray', args: `run -config ${configPath}` };
    case 'SING_BOX':
      return { bin: '/usr/local/bin/sing-box', args: `run -c ${configPath}` };
    case 'SS_LIBEV':
      return { bin: '/usr/bin/ss-server', args: `-c ${configPath}` };
    case 'XRAY':
    default:
      return { bin: '/usr/local/bin/xray', args: `run -config ${configPath}` };
  }
}

// ─── Xray / V2Ray ────────────────────────────────────────────────────────────

function generateXrayConfig(node: NodeInfo, creds: NodeCredentials): string {
  return JSON.stringify(
    {
      log: { loglevel: 'warning' },
      inbounds: [
        {
          tag: `in-${node.id}`,
          port: node.listenPort,
          listen: '0.0.0.0',
          protocol: xrayProtocol(node.protocol),
          settings: xraySettings(node.protocol, creds),
          streamSettings: xrayStreamSettings(node.transport, node.tls, node.domain),
        },
      ],
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

function xraySettings(protocol: string, creds: NodeCredentials): unknown {
  switch (protocol) {
    case 'VMESS':
      return { clients: [{ id: creds.uuid ?? '', alterId: 0 }] };
    case 'VLESS':
      return { clients: [{ id: creds.uuid ?? '', flow: '' }], decryption: 'none' };
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
  transport: string | null,
  tls: string,
  domain: string | null,
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
      certificates: [],
    };
  } else if (tls === 'REALITY') {
    base.security = 'reality';
    base.realitySettings = {
      dest: `${domain ?? 'www.google.com'}:443`,
      serverNames: [domain ?? 'www.google.com'],
      privateKey: '',  // must be filled by operator
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
    QUIC: 'quic',
  };
  return map[transport ?? 'TCP'] ?? 'tcp';
}

// ─── sing-box ────────────────────────────────────────────────────────────────

function generateSingBoxConfig(node: NodeInfo, creds: NodeCredentials): string {
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

function generateSsLibevConfig(node: NodeInfo, creds: NodeCredentials): string {
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
