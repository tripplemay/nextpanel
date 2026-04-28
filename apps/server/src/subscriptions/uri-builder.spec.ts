import { buildShareUri, buildClashProxy, buildSingboxOutbound } from './uri-builder';
import type { NodeExportInfo } from './uri-builder';
import { REALITY_FLOW, REALITY_DEFAULT_SNI } from '../nodes/protocols/reality';

const baseVless: NodeExportInfo = {
  name: 'TestNode',
  protocol: 'VLESS',
  host: '1.2.3.4',
  port: 443,
  transport: 'TCP',
  tls: 'NONE',
  domain: null,
  credentials: { uuid: 'test-uuid', realityPublicKey: 'pubkey123' },
};

const realityVless: NodeExportInfo = { ...baseVless, tls: 'REALITY' };
const tlsVless: NodeExportInfo = { ...baseVless, tls: 'TLS', domain: 'example.com' };

// ── vless:// URI ──────────────────────────────────────────────────────────────

describe('buildShareUri – VLESS+REALITY', () => {
  it('URI 包含 flow=xtls-rprx-vision', () => {
    const uri = buildShareUri(realityVless)!;
    expect(uri).toContain(`flow=${REALITY_FLOW}`);
  });

  it('URI 包含 security=reality', () => {
    const uri = buildShareUri(realityVless)!;
    expect(uri).toContain('security=reality');
  });

  it('URI 包含 pbk（公钥）', () => {
    const uri = buildShareUri(realityVless)!;
    expect(uri).toContain('pbk=pubkey123');
  });

  it('domain 为 null 时 sni 使用默认值', () => {
    const uri = buildShareUri(realityVless)!;
    expect(uri).toContain(`sni=${REALITY_DEFAULT_SNI}`);
  });

  it('domain 有值时 sni 使用 domain', () => {
    const uri = buildShareUri({ ...realityVless, domain: 'mysite.com' })!;
    expect(uri).toContain('sni=mysite.com');
  });
});

describe('buildShareUri – VLESS 非 REALITY 时不含 flow', () => {
  it('VLESS+TLS 不含 flow 参数', () => {
    const uri = buildShareUri(tlsVless)!;
    expect(uri).not.toContain('flow=');
  });

  it('VLESS+NONE 不含 flow 参数', () => {
    const uri = buildShareUri(baseVless)!;
    expect(uri).not.toContain('flow=');
  });
});

// ── Clash YAML ────────────────────────────────────────────────────────────────

describe('buildClashProxy – VLESS+REALITY', () => {
  it('包含 flow: xtls-rprx-vision', () => {
    const yaml = buildClashProxy(realityVless)!;
    expect(yaml).toContain(`flow: ${REALITY_FLOW}`);
  });

  it('包含 reality-opts 和 public-key', () => {
    const yaml = buildClashProxy(realityVless)!;
    expect(yaml).toContain('reality-opts:');
    expect(yaml).toContain('public-key: pubkey123');
  });
});

describe('buildClashProxy – VLESS 非 REALITY 时不含 flow', () => {
  it('VLESS+TLS 不含 flow', () => {
    const yaml = buildClashProxy(tlsVless)!;
    expect(yaml).not.toContain('flow:');
  });
});

// ── Sing-box JSON ─────────────────────────────────────────────────────────────

describe('buildSingboxOutbound – VLESS+REALITY', () => {
  it('包含 flow: xtls-rprx-vision', () => {
    const out = buildSingboxOutbound(realityVless) as Record<string, unknown>;
    expect(out.flow).toBe(REALITY_FLOW);
  });

  it('tls 对象包含 reality 块和 public_key', () => {
    const out = buildSingboxOutbound(realityVless) as Record<string, unknown>;
    const tls = out.tls as Record<string, unknown>;
    const reality = tls.reality as Record<string, unknown>;
    expect(reality.enabled).toBe(true);
    expect(reality.public_key).toBe('pubkey123');
  });

  it('tls.server_name 使用默认 SNI', () => {
    const out = buildSingboxOutbound(realityVless) as Record<string, unknown>;
    const tls = out.tls as Record<string, unknown>;
    expect(tls.server_name).toBe(REALITY_DEFAULT_SNI);
  });
});

describe('buildSingboxOutbound – VLESS 非 REALITY 时不含 flow', () => {
  it('VLESS+TLS 不含 flow 字段', () => {
    const out = buildSingboxOutbound(tlsVless) as Record<string, unknown>;
    expect(out.flow).toBeUndefined();
  });

  it('VLESS+NONE 不含 flow 字段', () => {
    const out = buildSingboxOutbound(baseVless) as Record<string, unknown>;
    expect(out.flow).toBeUndefined();
  });
});

// ── Hysteria2 ─────────────────────────────────────────────────────────────────

const hy2Node: NodeExportInfo = {
  name: 'HY2-Node',
  protocol: 'HYSTERIA2',
  host: '5.6.7.8',
  port: 4430,
  transport: null,
  tls: 'TLS',
  domain: 'hy2.example.com',
  credentials: { password: 'secret123' },
};

describe('buildShareUri – HYSTERIA2', () => {
  it('returns hy2:// URI with password', () => {
    const uri = buildShareUri(hy2Node)!;
    expect(uri).toMatch(/^hy2:\/\//);
    expect(uri).toContain('secret123');
  });

  it('includes sni param when domain is set', () => {
    const uri = buildShareUri(hy2Node)!;
    expect(uri).toContain('sni=hy2.example.com');
  });

  it('omits sni param when domain is null', () => {
    const uri = buildShareUri({ ...hy2Node, domain: null })!;
    expect(uri).not.toContain('sni=');
  });

  it('includes host and port', () => {
    const uri = buildShareUri(hy2Node)!;
    expect(uri).toContain('@5.6.7.8:4430');
  });
});

describe('buildClashProxy – HYSTERIA2', () => {
  it('includes type: hysteria2', () => {
    const yaml = buildClashProxy(hy2Node)!;
    expect(yaml).toContain('type: hysteria2');
  });

  it('includes password', () => {
    const yaml = buildClashProxy(hy2Node)!;
    expect(yaml).toContain('password: secret123');
  });

  it('includes sni when domain is set', () => {
    const yaml = buildClashProxy(hy2Node)!;
    expect(yaml).toContain('sni: hy2.example.com');
  });
});

describe('buildSingboxOutbound – HYSTERIA2', () => {
  it('returns type hysteria2', () => {
    const out = buildSingboxOutbound(hy2Node) as Record<string, unknown>;
    expect(out.type).toBe('hysteria2');
  });

  it('includes password', () => {
    const out = buildSingboxOutbound(hy2Node) as Record<string, unknown>;
    expect(out.password).toBe('secret123');
  });

  it('includes tls.enabled = true', () => {
    const out = buildSingboxOutbound(hy2Node) as Record<string, unknown>;
    const tls = out.tls as Record<string, unknown>;
    expect(tls.enabled).toBe(true);
  });

  it('includes tls.server_name when domain is set', () => {
    const out = buildSingboxOutbound(hy2Node) as Record<string, unknown>;
    const tls = out.tls as Record<string, unknown>;
    expect(tls.server_name).toBe('hy2.example.com');
  });

  it('no server_name when domain is null', () => {
    const out = buildSingboxOutbound({ ...hy2Node, domain: null }) as Record<string, unknown>;
    const tls = out.tls as Record<string, unknown>;
    expect(tls.server_name).toBeUndefined();
  });
});

// ── UDP forwarding (Clash) ────────────────────────────────────────────────────
// Clash/Mihomo defaults proxy `udp` to false. Without this flag, QUIC/HTTP3
// traffic to AI services (which Chrome enables via Alt-Svc) silently drops.

describe('buildClashProxy – udp 转发开关', () => {
  const ssNode: NodeExportInfo = {
    name: 'SS', protocol: 'SHADOWSOCKS', host: '1.1.1.1', port: 8388,
    transport: null, tls: 'NONE', domain: null,
    credentials: { password: 'pw', method: 'aes-256-gcm' },
  };
  const trojanNode: NodeExportInfo = {
    name: 'TR', protocol: 'TROJAN', host: '1.1.1.1', port: 443,
    transport: 'WS', tls: 'TLS', domain: 'tr.example.com',
    credentials: { password: 'pw' },
  };
  const vmessNode: NodeExportInfo = {
    name: 'VM', protocol: 'VMESS', host: '1.1.1.1', port: 443,
    transport: 'WS', tls: 'TLS', domain: 'vm.example.com',
    credentials: { uuid: 'uuid' },
  };

  it.each([
    ['VLESS+REALITY', realityVless],
    ['VLESS+TLS', tlsVless],
    ['VMESS+WS+TLS', vmessNode],
    ['TROJAN+WS+TLS', trojanNode],
    ['SHADOWSOCKS', ssNode],
    ['HYSTERIA2', hy2Node],
  ])('%s 输出 udp: true', (_name, node) => {
    const yaml = buildClashProxy(node)!;
    expect(yaml).toContain('udp: true');
  });
});
