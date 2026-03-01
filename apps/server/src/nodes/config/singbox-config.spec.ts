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

  it('REALITY mode falls back to www.google.com when domain is null', () => {
    const cfg = parseSingBox({ ...baseNode, tls: 'REALITY', domain: null });
    expect(cfg.inbounds[0].tls.reality.handshake.server).toBe('www.google.com');
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
