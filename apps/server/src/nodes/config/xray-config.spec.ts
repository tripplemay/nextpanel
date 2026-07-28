import { generateXrayConfig } from './xray-config';
import type { NodeInfo, NodeCredentials } from './config-generator';

const baseNode: NodeInfo = {
  id: 'n1',
  protocol: 'VMESS',
  implementation: 'XRAY',
  transport: 'TCP',
  tls: 'NONE',
  listenPort: 10080,
  domain: null,
};

const baseCreds: NodeCredentials = {
  uuid: 'aaa-bbb-ccc',
  password: 'secret',
  method: 'aes-256-gcm',
  username: 'user1',
  shortId: '0123456789abcdef',
  path: '/xhttp-test',
};

function parse(node: NodeInfo, creds: NodeCredentials = baseCreds) {
  return JSON.parse(generateXrayConfig(node, creds));
}

// ── Top-level structure ───────────────────────────────────────────────────────

describe('generateXrayConfig – structure', () => {
  it('produces valid JSON with expected top-level keys', () => {
    const cfg = parse(baseNode);
    expect(cfg).toHaveProperty('log');
    expect(cfg).toHaveProperty('inbounds');
    expect(cfg).toHaveProperty('outbounds');
  });

  it('inbound tag matches node id', () => {
    const cfg = parse(baseNode);
    expect(cfg.inbounds[0].tag).toBe('in-n1');
  });

  it('inbound port matches listenPort', () => {
    const cfg = parse(baseNode);
    expect(cfg.inbounds[0].port).toBe(10080);
  });

  it('listens on the IPv6 wildcard for dual-stack reachability', () => {
    const cfg = parse(baseNode);
    expect(cfg.inbounds[0].listen).toBe('::');
  });

  it('outbound is freedom', () => {
    const cfg = parse(baseNode);
    expect(cfg.outbounds[0].protocol).toBe('freedom');
  });
});

// ── Chain routing ─────────────────────────────────────────────────────────────

describe('generateXrayConfig – chain routing', () => {
  const chainNode: NodeInfo = {
    ...baseNode,
    chainExitIp: '203.0.113.20',
    chainExitPort: 15001,
    chainUuid: 'chain-uuid',
  };

  it('protects a new chain with REALITY and explicit XUDP mux settings', () => {
    const cfg = parse({
      ...chainNode,
      chainRealityPrivateKey: 'chain-private-key',
      chainRealityPublicKey: 'chain-public-key',
      chainShortId: '0123456789abcdef',
    });
    const outbound = cfg.outbounds[0];

    expect(outbound.streamSettings).toEqual({
      network: 'tcp',
      security: 'reality',
      realitySettings: {
        serverName: 'addons.mozilla.org',
        fingerprint: 'chrome',
        password: 'chain-public-key',
        shortId: '0123456789abcdef',
      },
      sockopt: { tcpKeepAliveInterval: 30 },
    });
    expect(outbound.mux).toEqual({
      enabled: true,
      concurrency: 8,
      xudpConcurrency: 16,
      xudpProxyUDP443: 'allow',
    });
    expect(cfg.routing.rules[0]).toEqual({
      type: 'field',
      inboundTag: ['in-n1'],
      outboundTag: 'chain-exit',
    });
    expect(JSON.stringify(cfg)).not.toContain('chain-private-key');
  });

  it('preserves plaintext VLESS for legacy chains without REALITY credentials', () => {
    const cfg = parse(chainNode);
    expect(cfg.outbounds[0].streamSettings.security).toBe('none');
    expect(cfg.outbounds[0].streamSettings.realitySettings).toBeUndefined();
    expect(cfg.outbounds[0].mux).toBeUndefined();
  });

  it('rejects partial REALITY credentials on a chain', () => {
    expect(() =>
      parse({
        ...chainNode,
        chainRealityPublicKey: 'chain-public-key',
        chainShortId: '0123456789abcdef',
      }),
    ).toThrow('Secure chain requires complete REALITY key and short ID credentials');
  });

  it('ignores chain-only credentials when chain routing is disabled', () => {
    expect(() => parse({ ...baseNode, chainRealityPublicKey: 'stale-key' })).not.toThrow();
  });
});

// ── Protocol mapping ──────────────────────────────────────────────────────────

describe('generateXrayConfig – protocols', () => {
  it.each([
    ['VMESS', 'vmess'],
    ['VLESS', 'vless'],
    ['TROJAN', 'trojan'],
    ['SHADOWSOCKS', 'shadowsocks'],
    ['SOCKS5', 'socks'],
    ['HTTP', 'http'],
  ])('maps %s → %s', (protocol, expected) => {
    const cfg = parse({ ...baseNode, protocol });
    expect(cfg.inbounds[0].protocol).toBe(expected);
  });

  it('lowercases unknown protocol as fallback', () => {
    const cfg = parse({ ...baseNode, protocol: 'CUSTOM' });
    expect(cfg.inbounds[0].protocol).toBe('custom');
  });
});

// ── Settings per protocol ─────────────────────────────────────────────────────

describe('generateXrayConfig – inbound settings', () => {
  it('VMESS includes uuid in clients', () => {
    const cfg = parse({ ...baseNode, protocol: 'VMESS' });
    expect(cfg.inbounds[0].settings.clients[0].id).toBe('aaa-bbb-ccc');
  });

  it('VLESS includes uuid and decryption:none', () => {
    const cfg = parse({ ...baseNode, protocol: 'VLESS' });
    expect(cfg.inbounds[0].settings.clients[0].id).toBe('aaa-bbb-ccc');
    expect(cfg.inbounds[0].settings.decryption).toBe('none');
  });

  it('VLESS+REALITY 服务端 client 必须包含 flow:xtls-rprx-vision', () => {
    const cfg = parse({ ...baseNode, protocol: 'VLESS', tls: 'REALITY' });
    expect(cfg.inbounds[0].settings.clients[0].flow).toBe('xtls-rprx-vision');
  });

  it('VLESS+XHTTP+REALITY 服务端 client flow 为空字符串', () => {
    const cfg = parse({
      ...baseNode,
      protocol: 'VLESS',
      transport: 'XHTTP',
      tls: 'REALITY',
    });
    expect(cfg.inbounds[0].settings.clients[0].flow).toBe('');
  });

  it('VLESS+TLS 服务端 client flow 为空字符串', () => {
    const cfg = parse({ ...baseNode, protocol: 'VLESS', tls: 'TLS' });
    expect(cfg.inbounds[0].settings.clients[0].flow).toBe('');
  });

  it('VLESS+NONE 服务端 client flow 为空字符串', () => {
    const cfg = parse({ ...baseNode, protocol: 'VLESS', tls: 'NONE' });
    expect(cfg.inbounds[0].settings.clients[0].flow).toBe('');
  });

  it('TROJAN includes password in clients', () => {
    const cfg = parse({ ...baseNode, protocol: 'TROJAN' });
    expect(cfg.inbounds[0].settings.clients[0].password).toBe('secret');
  });

  it('SHADOWSOCKS includes method and password', () => {
    const cfg = parse({ ...baseNode, protocol: 'SHADOWSOCKS' });
    expect(cfg.inbounds[0].settings.method).toBe('aes-256-gcm');
    expect(cfg.inbounds[0].settings.password).toBe('secret');
  });

  it('SOCKS5 with username uses password auth', () => {
    const cfg = parse({ ...baseNode, protocol: 'SOCKS5' });
    expect(cfg.inbounds[0].settings.auth).toBe('password');
    expect(cfg.inbounds[0].settings.accounts[0].user).toBe('user1');
  });

  it('SOCKS5 without username uses noauth', () => {
    const cfg = parse({ ...baseNode, protocol: 'SOCKS5' }, { uuid: 'x' });
    expect(cfg.inbounds[0].settings.auth).toBe('noauth');
    expect(cfg.inbounds[0].settings.accounts).toHaveLength(0);
  });

  it('HTTP with username includes accounts', () => {
    const cfg = parse({ ...baseNode, protocol: 'HTTP' });
    expect(cfg.inbounds[0].settings.accounts[0].user).toBe('user1');
  });

  it('HTTP without username has empty accounts', () => {
    const cfg = parse({ ...baseNode, protocol: 'HTTP' }, {});
    expect(cfg.inbounds[0].settings.accounts).toHaveLength(0);
  });

  it('unknown protocol returns empty settings object', () => {
    const cfg = parse({ ...baseNode, protocol: 'CUSTOM' });
    expect(cfg.inbounds[0].settings).toEqual({});
  });
});

// ── Credential fallbacks (??-operator false branches) ─────────────────────────

describe('generateXrayConfig – credential fallbacks', () => {
  it('VMESS uses empty uuid when not provided', () => {
    const cfg = parse({ ...baseNode, protocol: 'VMESS' }, {});
    expect(cfg.inbounds[0].settings.clients[0].id).toBe('');
  });

  it('VLESS uses empty uuid when not provided', () => {
    const cfg = parse({ ...baseNode, protocol: 'VLESS' }, {});
    expect(cfg.inbounds[0].settings.clients[0].id).toBe('');
  });

  it('TROJAN uses empty password when not provided', () => {
    const cfg = parse({ ...baseNode, protocol: 'TROJAN' }, {});
    expect(cfg.inbounds[0].settings.clients[0].password).toBe('');
  });

  it('SHADOWSOCKS defaults to aes-256-gcm and empty password when creds are empty', () => {
    const cfg = parse({ ...baseNode, protocol: 'SHADOWSOCKS' }, {});
    expect(cfg.inbounds[0].settings.method).toBe('aes-256-gcm');
    expect(cfg.inbounds[0].settings.password).toBe('');
  });

  it('SOCKS5 uses empty pass when username provided but password missing', () => {
    const cfg = parse({ ...baseNode, protocol: 'SOCKS5' }, { username: 'user' });
    expect(cfg.inbounds[0].settings.accounts[0].pass).toBe('');
  });

  it('HTTP uses empty pass when username provided but password missing', () => {
    const cfg = parse({ ...baseNode, protocol: 'HTTP' }, { username: 'user' });
    expect(cfg.inbounds[0].settings.accounts[0].pass).toBe('');
  });
});

// ── Stream settings (transport) ───────────────────────────────────────────────

describe('generateXrayConfig – streamSettings', () => {
  it('TCP transport → network:tcp, security:none', () => {
    const cfg = parse({ ...baseNode, transport: 'TCP', tls: 'NONE' });
    expect(cfg.inbounds[0].streamSettings.network).toBe('tcp');
    expect(cfg.inbounds[0].streamSettings.security).toBe('none');
  });

  it('WS transport adds wsSettings', () => {
    const cfg = parse({ ...baseNode, transport: 'WS', tls: 'NONE' });
    expect(cfg.inbounds[0].streamSettings.network).toBe('ws');
    expect(cfg.inbounds[0].streamSettings.wsSettings.path).toBe('/');
  });

  it('GRPC transport adds grpcSettings', () => {
    const cfg = parse({ ...baseNode, transport: 'GRPC', tls: 'NONE' });
    expect(cfg.inbounds[0].streamSettings.network).toBe('grpc');
    expect(cfg.inbounds[0].streamSettings.grpcSettings.serviceName).toBe('grpc');
  });

  it('XHTTP transport adds path and auto mode', () => {
    const cfg = parse({ ...baseNode, transport: 'XHTTP', tls: 'REALITY' });
    const stream = cfg.inbounds[0].streamSettings;
    expect(stream.network).toBe('xhttp');
    expect(stream.xhttpSettings).toEqual({ path: '/xhttp-test', mode: 'auto' });
  });

  it('XHTTP transport normalizes a path without a leading slash', () => {
    const cfg = parse(
      { ...baseNode, transport: 'XHTTP', tls: 'REALITY' },
      { ...baseCreds, path: 'custom-path' },
    );
    expect(cfg.inbounds[0].streamSettings.xhttpSettings.path).toBe('/custom-path');
  });

  it('XHTTP transport defaults to root path when credentials omit it', () => {
    const cfg = parse(
      { ...baseNode, transport: 'XHTTP', tls: 'REALITY' },
      { uuid: 'uuid', realityPrivateKey: 'private-key' },
    );
    expect(cfg.inbounds[0].streamSettings.xhttpSettings.path).toBe('/');
  });

  it('RAW transport is passed through for current Xray configs', () => {
    const cfg = parse({ ...baseNode, protocol: 'VLESS', transport: 'RAW', tls: 'REALITY' });
    expect(cfg.inbounds[0].streamSettings.network).toBe('raw');
    expect(cfg.inbounds[0].settings.clients[0].flow).toBe('xtls-rprx-vision');
  });

  it('QUIC transport throws — removed in Xray 26.x', () => {
    expect(() => parse({ ...baseNode, transport: 'QUIC', tls: 'NONE' })).toThrow(
      'QUIC transport was removed in Xray 26.x',
    );
  });

  it('null transport defaults to tcp', () => {
    const cfg = parse({ ...baseNode, transport: null, tls: 'NONE' });
    expect(cfg.inbounds[0].streamSettings.network).toBe('tcp');
  });
});

// ── TLS settings ──────────────────────────────────────────────────────────────

describe('generateXrayConfig – TLS', () => {
  it('TLS mode sets security:tls with serverName', () => {
    const cfg = parse({ ...baseNode, tls: 'TLS', domain: 'example.com' });
    const ss = cfg.inbounds[0].streamSettings;
    expect(ss.security).toBe('tls');
    expect(ss.tlsSettings.serverName).toBe('example.com');
  });

  it('TLS mode includes cert/key file paths derived from node id', () => {
    const cfg = parse({ ...baseNode, tls: 'TLS', domain: 'example.com' });
    const certs = cfg.inbounds[0].streamSettings.tlsSettings.certificates;
    expect(certs).toHaveLength(1);
    expect(certs[0].certificateFile).toBe('/etc/nextpanel/certs/n1.crt');
    expect(certs[0].keyFile).toBe('/etc/nextpanel/certs/n1.key');
  });

  it('TLS mode falls back to empty string when domain is null', () => {
    const cfg = parse({ ...baseNode, tls: 'TLS', domain: null });
    expect(cfg.inbounds[0].streamSettings.tlsSettings.serverName).toBe('');
  });

  it('REALITY mode sets security:reality with dest', () => {
    const cfg = parse({ ...baseNode, tls: 'REALITY', domain: 'cdn.example.com' });
    const ss = cfg.inbounds[0].streamSettings;
    expect(ss.security).toBe('reality');
    expect(ss.realitySettings.dest).toBe('cdn.example.com:443');
  });

  it('REALITY mode falls back to REALITY_DEFAULT_SNI when domain is null', () => {
    const cfg = parse({ ...baseNode, tls: 'REALITY', domain: null });
    expect(cfg.inbounds[0].streamSettings.realitySettings.dest).toBe('addons.mozilla.org:443');
  });

  it('REALITY uses empty string for realityPrivateKey when not provided', () => {
    const cfg = parse({ ...baseNode, tls: 'REALITY' }, {});
    expect(cfg.inbounds[0].streamSettings.realitySettings.privateKey).toBe('');
  });

  it('REALITY uses the credential short ID', () => {
    const cfg = parse({ ...baseNode, tls: 'REALITY' });
    expect(cfg.inbounds[0].streamSettings.realitySettings.shortIds).toEqual([
      '0123456789abcdef',
    ]);
  });

  it('REALITY keeps the empty short ID fallback for existing nodes', () => {
    const cfg = parse({ ...baseNode, tls: 'REALITY' }, {});
    expect(cfg.inbounds[0].streamSettings.realitySettings.shortIds).toEqual(['']);
  });
});

// ── Transport fallback ────────────────────────────────────────────────────────

describe('generateXrayConfig – transport fallback', () => {
  it('unknown transport string falls back to tcp', () => {
    const cfg = parse({ ...baseNode, transport: 'WEBSOCKET' as any, tls: 'NONE' });
    expect(cfg.inbounds[0].streamSettings.network).toBe('tcp');
  });
});
