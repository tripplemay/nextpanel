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
