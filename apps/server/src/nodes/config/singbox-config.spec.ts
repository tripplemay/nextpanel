import { generateSingBoxConfig, generateSsLibevConfig } from './singbox-config';
import type { NodeInfo, NodeCredentials } from './config-generator';

const baseNode: NodeInfo = {
  id: 'sb-1',
  protocol: 'VMESS',
  implementation: 'SING_BOX',
  transport: null,
  tls: 'NONE',
  listenPort: 10090,
  domain: null,
};

const baseCreds: NodeCredentials = {
  uuid: 'uuid-sing',
  password: 'pass-sing',
  method: 'chacha20-ietf-poly1305',
  username: 'admin',
};

function parseSingBox(node: NodeInfo, creds: NodeCredentials = baseCreds) {
  return JSON.parse(generateSingBoxConfig(node, creds));
}

// ── Top-level structure ───────────────────────────────────────────────────────

describe('generateSingBoxConfig – structure', () => {
  it('produces valid JSON with expected keys', () => {
    const cfg = parseSingBox(baseNode);
    expect(cfg).toHaveProperty('log');
    expect(cfg).toHaveProperty('inbounds');
    expect(cfg).toHaveProperty('outbounds');
    expect(cfg.log.level).toBe('warn');
    expect(cfg.outbounds[0].type).toBe('direct');
  });

  it('inbound tag matches node id', () => {
    const cfg = parseSingBox(baseNode);
    expect(cfg.inbounds[0].tag).toBe('in-sb-1');
  });

  it('inbound listen_port matches listenPort', () => {
    const cfg = parseSingBox(baseNode);
    expect(cfg.inbounds[0].listen_port).toBe(10090);
  });
});

// ── Protocol mapping ──────────────────────────────────────────────────────────

describe('generateSingBoxConfig – inbound types', () => {
  it.each([
    ['VMESS', 'vmess'],
    ['VLESS', 'vless'],
    ['TROJAN', 'trojan'],
    ['SHADOWSOCKS', 'shadowsocks'],
    ['SOCKS5', 'socks'],
    ['HTTP', 'http'],
    ['HYSTERIA2', 'hysteria2'],
    ['TUIC', 'tuic'],
    ['ANYTLS', 'anytls'],
  ])('maps protocol %s → type %s', (protocol, expectedType) => {
    const cfg = parseSingBox({ ...baseNode, protocol });
    expect(cfg.inbounds[0].type).toBe(expectedType);
  });
});

// ── Credentials per protocol ──────────────────────────────────────────────────

describe('generateSingBoxConfig – credentials', () => {
  it('VMESS sets users with uuid', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'VMESS' });
    expect(cfg.inbounds[0].users[0].uuid).toBe('uuid-sing');
  });

  it('VLESS sets users with uuid', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'VLESS' });
    expect(cfg.inbounds[0].users[0].uuid).toBe('uuid-sing');
  });

  it('TROJAN sets users with password', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'TROJAN' });
    expect(cfg.inbounds[0].users[0].password).toBe('pass-sing');
  });

  it('SHADOWSOCKS sets method and password at root', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'SHADOWSOCKS' });
    expect(cfg.inbounds[0].method).toBe('chacha20-ietf-poly1305');
    expect(cfg.inbounds[0].password).toBe('pass-sing');
  });

  it('SOCKS5 with username sets users', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'SOCKS5' });
    expect(cfg.inbounds[0].users[0].username).toBe('admin');
  });

  it('SOCKS5 without username does not set users', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'SOCKS5' }, {});
    expect(cfg.inbounds[0].users).toBeUndefined();
  });

  it('HTTP with username sets users', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'HTTP' });
    expect(cfg.inbounds[0].users[0].username).toBe('admin');
  });

  it('HTTP without username does not set users', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'HTTP' }, {});
    expect(cfg.inbounds[0].users).toBeUndefined();
  });

  it('HYSTERIA2 sets users with password', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'HYSTERIA2' });
    expect(cfg.inbounds[0].users[0].password).toBe('pass-sing');
  });

  it('HYSTERIA2 sets tls with cert/key paths', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'HYSTERIA2' });
    expect(cfg.inbounds[0].tls.enabled).toBe(true);
    expect(cfg.inbounds[0].tls.certificate_path).toBe('/etc/nextpanel/certs/sb-1.crt');
    expect(cfg.inbounds[0].tls.key_path).toBe('/etc/nextpanel/certs/sb-1.key');
  });

  it('HYSTERIA2 uses empty password when not provided', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'HYSTERIA2' }, {});
    expect(cfg.inbounds[0].users[0].password).toBe('');
  });

  it('TUIC sets v5 credentials and secure transport defaults', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'TUIC' });
    const inbound = cfg.inbounds[0];
    expect(inbound.users).toEqual([{ uuid: 'uuid-sing', password: 'pass-sing' }]);
    expect(inbound.congestion_control).toBe('bbr');
    expect(inbound.zero_rtt_handshake).toBe(false);
    expect(inbound.heartbeat).toBe('10s');
  });

  it('TUIC sets tls with cert/key paths', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'TUIC' });
    expect(cfg.inbounds[0].tls).toEqual({
      enabled: true,
      certificate_path: '/etc/nextpanel/certs/sb-1.crt',
      key_path: '/etc/nextpanel/certs/sb-1.key',
    });
  });

  it('TUIC uses empty credentials when not provided', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'TUIC' }, {});
    expect(cfg.inbounds[0].users).toEqual([{ uuid: '', password: '' }]);
  });

  it('AnyTLS sets password user and tls certificate paths', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'ANYTLS' });
    expect(cfg.inbounds[0].users).toEqual([{ password: 'pass-sing' }]);
    expect(cfg.inbounds[0].tls).toEqual({
      enabled: true,
      certificate_path: '/etc/nextpanel/certs/sb-1.crt',
      key_path: '/etc/nextpanel/certs/sb-1.key',
    });
  });

  it('AnyTLS uses an empty password when not provided', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'ANYTLS' }, {});
    expect(cfg.inbounds[0].users).toEqual([{ password: '' }]);
  });
});

// ── Chain routing ─────────────────────────────────────────────────────────────

describe('generateSingBoxConfig – chain routing', () => {
  const chainNode: NodeInfo = {
    ...baseNode,
    protocol: 'HYSTERIA2',
    tls: 'TLS',
    domain: 'proxy.example.com',
    chainExitIp: '203.0.113.20',
    chainExitPort: 15001,
    chainUuid: 'chain-uuid',
  };

  it('sends entry inbound traffic through a VLESS XUDP chain outbound', () => {
    const cfg = parseSingBox(chainNode);
    expect(cfg.outbounds[0]).toEqual({
      type: 'vless',
      tag: 'chain-exit',
      server: '203.0.113.20',
      server_port: 15001,
      uuid: 'chain-uuid',
      packet_encoding: 'xudp',
    });
    expect(cfg.route.rules).toEqual([
      {
        inbound: ['in-sb-1'],
        action: 'route',
        outbound: 'chain-exit',
      },
    ]);
  });

  it('protects a new chain with REALITY TLS, uTLS, and XUDP', () => {
    const cfg = parseSingBox({
      ...chainNode,
      chainRealityPrivateKey: 'chain-private-key',
      chainRealityPublicKey: 'chain-public-key',
      chainShortId: '0123456789abcdef',
    });

    expect(cfg.outbounds[0]).toEqual({
      type: 'vless',
      tag: 'chain-exit',
      server: '203.0.113.20',
      server_port: 15001,
      uuid: 'chain-uuid',
      packet_encoding: 'xudp',
      tls: {
        enabled: true,
        server_name: 'addons.mozilla.org',
        utls: { enabled: true, fingerprint: 'chrome' },
        reality: {
          enabled: true,
          public_key: 'chain-public-key',
          short_id: '0123456789abcdef',
        },
      },
    });
    expect(JSON.stringify(cfg)).not.toContain('chain-private-key');
  });

  it('rejects partial REALITY credentials on a chain', () => {
    expect(() =>
      parseSingBox({
        ...chainNode,
        chainRealityPrivateKey: 'chain-private-key',
        chainShortId: '0123456789abcdef',
      }),
    ).toThrow('Secure chain requires complete REALITY key and short ID credentials');
  });

  it('ignores chain-only credentials when chain routing is disabled', () => {
    expect(() =>
      parseSingBox({ ...baseNode, chainRealityPrivateKey: 'stale-key' }),
    ).not.toThrow();
  });

  it('keeps direct as the fallback outbound', () => {
    const cfg = parseSingBox(chainNode);
    expect(cfg.outbounds).toContainEqual({ type: 'direct', tag: 'direct' });
    expect(cfg.route.final).toBe('direct');
  });

  it('does not enable chain routing when chain details are incomplete', () => {
    const cfg = parseSingBox({
      ...baseNode,
      protocol: 'HYSTERIA2',
      chainExitIp: '203.0.113.20',
    });
    expect(cfg.outbounds).toEqual([{ type: 'direct', tag: 'direct' }]);
    expect(cfg.route).toBeUndefined();
  });
});

// ── Transport ─────────────────────────────────────────────────────────────────

describe('generateSingBoxConfig – transport', () => {
  it('WS transport adds transport.type=ws', () => {
    const cfg = parseSingBox({ ...baseNode, transport: 'WS' });
    expect(cfg.inbounds[0].transport.type).toBe('ws');
    expect(cfg.inbounds[0].transport.path).toBe('/');
  });

  it('GRPC transport adds transport.type=grpc', () => {
    const cfg = parseSingBox({ ...baseNode, transport: 'GRPC' });
    expect(cfg.inbounds[0].transport.type).toBe('grpc');
    expect(cfg.inbounds[0].transport.service_name).toBe('grpc');
  });

  it('null transport does not add transport key', () => {
    const cfg = parseSingBox({ ...baseNode, transport: null });
    expect(cfg.inbounds[0].transport).toBeUndefined();
  });
});

// ── TLS ───────────────────────────────────────────────────────────────────────

describe('generateSingBoxConfig – TLS', () => {
  it('TLS mode enables tls with server_name', () => {
    const cfg = parseSingBox({ ...baseNode, tls: 'TLS', domain: 'tls.example.com' });
    expect(cfg.inbounds[0].tls.enabled).toBe(true);
    expect(cfg.inbounds[0].tls.server_name).toBe('tls.example.com');
  });

  it('REALITY mode enables reality block', () => {
    const cfg = parseSingBox({ ...baseNode, tls: 'REALITY', domain: 'reality.example.com' });
    expect(cfg.inbounds[0].tls.reality.enabled).toBe(true);
    expect(cfg.inbounds[0].tls.reality.handshake.server).toBe('reality.example.com');
  });

  it('REALITY mode falls back to REALITY_DEFAULT_SNI when domain is null', () => {
    const cfg = parseSingBox({ ...baseNode, tls: 'REALITY', domain: null });
    expect(cfg.inbounds[0].tls.reality.handshake.server).toBe('addons.mozilla.org');
  });

  it('REALITY mode uses realityPrivateKey from credentials', () => {
    const creds: NodeCredentials = { ...baseCreds, realityPrivateKey: 'my-private-key' };
    const cfg = parseSingBox({ ...baseNode, tls: 'REALITY', domain: 'example.com' }, creds);
    expect(cfg.inbounds[0].tls.reality.private_key).toBe('my-private-key');
  });

  it('REALITY mode uses the same short ID exported to clients', () => {
    const creds: NodeCredentials = {
      ...baseCreds,
      realityPrivateKey: 'my-private-key',
      shortId: '0123456789abcdef',
    };
    const cfg = parseSingBox(
      { ...baseNode, tls: 'REALITY', domain: 'example.com' },
      creds,
    );
    expect(cfg.inbounds[0].tls.reality.short_id).toEqual(['0123456789abcdef']);
  });

  it('REALITY mode uses empty string for private_key when not provided', () => {
    const cfg = parseSingBox({ ...baseNode, tls: 'REALITY', domain: 'example.com' }, {});
    expect(cfg.inbounds[0].tls.reality.private_key).toBe('');
  });

  it('NONE tls does not add tls key', () => {
    const cfg = parseSingBox({ ...baseNode, tls: 'NONE' });
    expect(cfg.inbounds[0].tls).toBeUndefined();
  });

  it('TLS mode uses empty server_name when domain is null', () => {
    const cfg = parseSingBox({ ...baseNode, tls: 'TLS', domain: null });
    expect(cfg.inbounds[0].tls.server_name).toBe('');
  });
});

// ── Credential fallbacks ───────────────────────────────────────────────────────

describe('generateSingBoxConfig – credential fallbacks', () => {
  it('VMESS uses empty uuid when not provided', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'VMESS' }, {});
    expect(cfg.inbounds[0].users[0].uuid).toBe('');
  });

  it('VLESS uses empty uuid when not provided', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'VLESS' }, {});
    expect(cfg.inbounds[0].users[0].uuid).toBe('');
  });

  it('TROJAN uses empty password when not provided', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'TROJAN' }, {});
    expect(cfg.inbounds[0].users[0].password).toBe('');
  });

  it('unknown protocol lowercases as singBoxType fallback', () => {
    const cfg = parseSingBox({ ...baseNode, protocol: 'CUSTOM_PROTO' });
    expect(cfg.inbounds[0].type).toBe('custom_proto');
  });
});

// ── ss-libev ──────────────────────────────────────────────────────────────────

describe('generateSsLibevConfig', () => {
  it('produces valid JSON with server fields', () => {
    const node: NodeInfo = { ...baseNode, implementation: 'SS_LIBEV', protocol: 'SHADOWSOCKS' };
    const cfg = JSON.parse(generateSsLibevConfig(node, baseCreds));
    expect(cfg.server).toBe('0.0.0.0');
    expect(cfg.server_port).toBe(10090);
    expect(cfg.method).toBe('chacha20-ietf-poly1305');
    expect(cfg.password).toBe('pass-sing');
    expect(cfg.mode).toBe('tcp_and_udp');
  });

  it('defaults method to aes-256-gcm when not provided', () => {
    const node: NodeInfo = { ...baseNode, implementation: 'SS_LIBEV', protocol: 'SHADOWSOCKS' };
    const cfg = JSON.parse(generateSsLibevConfig(node, {}));
    expect(cfg.method).toBe('aes-256-gcm');
    expect(cfg.password).toBe('');
  });
});
