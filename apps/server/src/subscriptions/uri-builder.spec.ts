import {
  buildShareUri,
  buildClashProxy,
  buildSingboxOutbound,
  buildClashSubscription,
  buildFullSingboxConfig,
  buildHomeProxyConfig,
  buildHiddifyDeepLink,
} from './uri-builder';
import type { NodeExportInfo } from './uri-builder';
import { REALITY_FLOW, REALITY_DEFAULT_SNI } from '../nodes/protocols/reality';
import { spawnSync } from 'node:child_process';

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
const xhttpVless: NodeExportInfo = {
  ...baseVless,
  name: 'XHTTP-Node',
  port: 11443,
  transport: 'XHTTP',
  tls: 'REALITY',
  credentials: {
    uuid: 'xhttp-uuid',
    path: 'cdn/edge',
    xhttpHost: 'edge.example.com',
    xhttpMode: 'stream-up',
    xhttpExtra: '{"xPaddingBytes":"100-1000"}',
    realityPublicKey: 'xhttp-public-key',
    shortId: 'a1b2c3d4e5f60708',
  },
};
const tuicNode: NodeExportInfo = {
  name: 'TUIC-Node',
  protocol: 'TUIC',
  host: '5.6.7.8',
  port: 16443,
  transport: 'QUIC',
  tls: 'TLS',
  domain: 'tuic.example.com',
  credentials: { uuid: 'tuic-uuid', password: 'tuic-password' },
};
const anytlsNode: NodeExportInfo = {
  name: 'AnyTLS-Node',
  protocol: 'ANYTLS',
  host: '9.10.11.12',
  port: 17443,
  transport: 'TCP',
  tls: 'TLS',
  domain: 'anytls.example.com',
  credentials: { password: 'anytls-password' },
};

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

describe('buildShareUri – IPv6 authority formatting', () => {
  const ipv6 = '2001:db8::1234';

  it.each([
    ['VLESS', { protocol: 'VLESS', credentials: { uuid: 'uuid' } }, `@[${ipv6}]:443`],
    ['Trojan', { protocol: 'TROJAN', credentials: { password: 'secret' } }, `@[${ipv6}]:443`],
    ['Shadowsocks', { protocol: 'SHADOWSOCKS', credentials: { method: 'aes-256-gcm', password: 'secret' } }, `@[${ipv6}]:443`],
    ['Hysteria2', { protocol: 'HYSTERIA2', credentials: { password: 'secret' } }, `@[${ipv6}]:443`],
    ['SOCKS5', { protocol: 'SOCKS5', credentials: {} }, `socks5://[${ipv6}]:443`],
    ['HTTP', { protocol: 'HTTP', credentials: {} }, `http://[${ipv6}]:443`],
  ])('brackets an IPv6 host in %s URI authority', (_name, overrides, expected) => {
    const uri = buildShareUri({ ...baseVless, ...overrides, host: ipv6 });
    expect(uri).toContain(expected);
  });

  it('does not double-bracket an already formatted IPv6 host', () => {
    const uri = buildShareUri({ ...baseVless, host: `[${ipv6}]` });
    expect(uri).toContain(`@[${ipv6}]:443`);
    expect(uri).not.toContain(`[[${ipv6}]]`);
  });

  it('keeps the VMess JSON address bare because it is not a URI authority', () => {
    const uri = buildShareUri({ ...baseVless, protocol: 'VMESS', host: ipv6 })!;
    const payload = JSON.parse(Buffer.from(uri.slice('vmess://'.length), 'base64').toString());
    expect(payload.add).toBe(ipv6);
  });
});

describe('buildShareUri – SOCKS5 authentication', () => {
  it('exports URL-encoded username and password', () => {
    const uri = buildShareUri({
      ...baseVless,
      protocol: 'SOCKS5',
      credentials: { username: 'demo user', password: 'p@ss:word' },
    });

    expect(uri).toBe('socks5://demo%20user:p%40ss%3Aword@1.2.3.4:443#TestNode');
  });
});

describe('buildShareUri – VLESS+XHTTP+REALITY', () => {
  it('exports all XHTTP share fields and REALITY credentials', () => {
    const uri = new URL(buildShareUri(xhttpVless)!);

    expect(uri.searchParams.get('type')).toBe('xhttp');
    expect(uri.searchParams.get('path')).toBe('/cdn/edge');
    expect(uri.searchParams.get('host')).toBe('edge.example.com');
    expect(uri.searchParams.get('mode')).toBe('stream-up');
    expect(uri.searchParams.get('extra')).toBe('{"xPaddingBytes":"100-1000"}');
    expect(uri.searchParams.get('security')).toBe('reality');
    expect(uri.searchParams.get('pbk')).toBe('xhttp-public-key');
    expect(uri.searchParams.get('sid')).toBe('a1b2c3d4e5f60708');
  });

  it('does not export the incompatible Vision flow', () => {
    const uri = new URL(buildShareUri(xhttpVless)!);
    expect(uri.searchParams.has('flow')).toBe(false);
  });

  it('retains XHTTP fields in legacy VMess JSON without reusing host as SNI', () => {
    const uri = buildShareUri({ ...xhttpVless, protocol: 'VMESS', domain: 'tls.example.com' })!;
    const payload = JSON.parse(Buffer.from(uri.slice('vmess://'.length), 'base64').toString());

    expect(payload).toMatchObject({
      net: 'xhttp',
      host: 'edge.example.com',
      path: '/cdn/edge',
      mode: 'stream-up',
      extra: '{"xPaddingBytes":"100-1000"}',
      sni: 'tls.example.com',
    });
  });

  it('defaults a missing path to the root path', () => {
    const uri = new URL(buildShareUri({
      ...xhttpVless,
      credentials: { ...xhttpVless.credentials, path: '' },
    })!);
    expect(uri.searchParams.get('path')).toBe('/');
  });

  it('keeps TUIC out of URI subscriptions and emits the official AnyTLS URI', () => {
    expect(buildShareUri(tuicNode)).toBeNull();
    expect(buildShareUri(anytlsNode)).toBe(
      'anytls://anytls-password@9.10.11.12:17443/?insecure=0&sni=anytls.example.com#AnyTLS-Node',
    );
  });

  it('percent-encodes AnyTLS passwords and brackets IPv6 authorities', () => {
    expect(buildShareUri({
      ...anytlsNode,
      host: '2001:db8::8',
      credentials: { password: 'p@ss /?#' },
    })).toBe(
      'anytls://p%40ss%20%2F%3F%23@[2001:db8::8]:17443/?insecure=0&sni=anytls.example.com#AnyTLS-Node',
    );
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

describe('buildClashProxy – modern protocol presets', () => {
  it('exports VLESS XHTTP with matching path, mode, and REALITY options', () => {
    const yaml = buildClashProxy(xhttpVless)!;

    expect(yaml).toContain('type: vless');
    expect(yaml).toContain('network: xhttp');
    expect(yaml).toContain('xhttp-opts:');
    expect(yaml).toContain('path: /cdn/edge');
    expect(yaml).toContain('host: edge.example.com');
    expect(yaml).toContain('mode: stream-up');
    expect(yaml).toContain('x-padding-bytes: 100-1000');
    expect(yaml).toContain('public-key: xhttp-public-key');
    expect(yaml).toContain('short-id: "a1b2c3d4e5f60708"');
    expect(yaml).not.toContain('flow:');
  });

  it.each([
    ['VMESS'],
    ['TROJAN'],
  ])('omits unsupported Mihomo %s XHTTP nodes instead of downgrading them', (protocol) => {
    expect(buildClashProxy({ ...xhttpVless, protocol })).toBeNull();
  });

  it('maps Xray xmux and downloadSettings extra into Mihomo XHTTP options', () => {
    const yaml = buildClashProxy({
      ...xhttpVless,
      credentials: {
        ...xhttpVless.credentials,
        xhttpExtra: JSON.stringify({
          xmux: { maxConnections: 4, hKeepAlivePeriod: 30 },
          downloadSettings: {
            address: 'download.example.com',
            port: 443,
            security: 'tls',
            tlsSettings: { serverName: 'download.example.com' },
            xhttpSettings: { path: '/down' },
          },
        }),
      },
    })!;
    expect(yaml).toContain('reuse-settings:');
    expect(yaml).toContain('max-connections: 4');
    expect(yaml).toContain('download-settings:');
    expect(yaml).toContain('server: download.example.com');
    expect(yaml).toContain('path: /down');
  });

  it('always quotes numeric-only REALITY short IDs as YAML strings', () => {
    const yaml = buildClashProxy({
      ...xhttpVless,
      credentials: { ...xhttpVless.credentials, shortId: '0123456789012345' },
    })!;

    expect(yaml).toContain('short-id: "0123456789012345"');
  });

  it('exports TUIC v5 with native UDP, BBR, and verified TLS', () => {
    const yaml = buildClashProxy(tuicNode)!;

    expect(yaml).toContain('type: tuic');
    expect(yaml).toContain('uuid: tuic-uuid');
    expect(yaml).toContain('password: tuic-password');
    expect(yaml).toContain('udp: true');
    expect(yaml).toContain('udp-relay-mode: native');
    expect(yaml).toContain('congestion-controller: bbr');
    expect(yaml).toContain('reduce-rtt: false');
    expect(yaml).toContain('sni: tuic.example.com');
    expect(yaml).toContain('skip-cert-verify: false');
    expect(yaml).not.toContain('token:');
  });

  it('exports AnyTLS with UDP and verified TLS', () => {
    const yaml = buildClashProxy(anytlsNode)!;

    expect(yaml).toContain('type: anytls');
    expect(yaml).toContain('password: anytls-password');
    expect(yaml).toContain('udp: true');
    expect(yaml).toContain('sni: anytls.example.com');
    expect(yaml).toContain('skip-cert-verify: false');
    expect(yaml).not.toContain('skip-cert-verify: true');
  });

  it('includes all three protocols in the complete Mihomo subscription', () => {
    const yaml = buildClashSubscription([xhttpVless, tuicNode, anytlsNode], 'https://panel.example.com');

    expect(yaml).toContain('network: xhttp');
    expect(yaml).toContain('type: tuic');
    expect(yaml).toContain('type: anytls');
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

  it('exports the configured REALITY short ID', () => {
    const out = buildSingboxOutbound({
      ...realityVless,
      credentials: { ...realityVless.credentials, shortId: '0123456789abcdef' },
    }) as Record<string, unknown>;
    const tls = out.tls as Record<string, unknown>;
    const reality = tls.reality as Record<string, unknown>;

    expect(reality.short_id).toBe('0123456789abcdef');
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

describe('buildSingboxOutbound – modern protocol presets', () => {
  it('omits XHTTP instead of incorrectly downgrading it to VLESS/TCP', () => {
    expect(buildSingboxOutbound(xhttpVless)).toBeNull();
  });

  it.each(['VMESS', 'TROJAN'])('omits %s XHTTP instead of downgrading it to TCP', (protocol) => {
    expect(buildSingboxOutbound({ ...xhttpVless, protocol })).toBeNull();
  });

  it('exports TUIC with native UDP, BBR, disabled 0-RTT, and verified TLS', () => {
    expect(buildSingboxOutbound(tuicNode)).toEqual({
      type: 'tuic',
      tag: 'TUIC-Node',
      server: '5.6.7.8',
      server_port: 16443,
      uuid: 'tuic-uuid',
      password: 'tuic-password',
      congestion_control: 'bbr',
      udp_relay_mode: 'native',
      zero_rtt_handshake: false,
      tls: {
        enabled: true,
        insecure: false,
        server_name: 'tuic.example.com',
      },
    });
  });

  it('exports AnyTLS with verified TLS and SNI', () => {
    expect(buildSingboxOutbound(anytlsNode)).toEqual({
      type: 'anytls',
      tag: 'AnyTLS-Node',
      server: '9.10.11.12',
      server_port: 17443,
      password: 'anytls-password',
      tls: {
        enabled: true,
        insecure: false,
        server_name: 'anytls.example.com',
      },
    });
  });

  it.each([
    ['full sing-box', buildFullSingboxConfig],
    ['HomeProxy', buildHomeProxyConfig],
  ])('%s filters XHTTP while retaining TUIC and AnyTLS', (_name, buildConfig) => {
    const config = JSON.parse(buildConfig([xhttpVless, tuicNode, anytlsNode])) as {
      outbounds: Array<Record<string, unknown>>;
    };

    expect(config.outbounds).not.toContainEqual(expect.objectContaining({ tag: 'XHTTP-Node' }));
    expect(config.outbounds).toContainEqual(expect.objectContaining({ type: 'tuic', tag: 'TUIC-Node' }));
    expect(config.outbounds).toContainEqual(expect.objectContaining({ type: 'anytls', tag: 'AnyTLS-Node' }));
  });

  it.each([
    ['full sing-box', buildFullSingboxConfig],
    ['HomeProxy', buildHomeProxyConfig],
  ])('%s rejects an XHTTP-only subscription instead of leaking traffic direct', (_name, buildConfig) => {
    expect(() => buildConfig([xhttpVless])).toThrow(
      'sing-box does not support XHTTP; use the Mihomo subscription',
    );
  });

  it.each([
    ['full sing-box', buildFullSingboxConfig],
    ['HomeProxy', buildHomeProxyConfig],
  ])('%s uses the sing-box 1.13 DNS and route schema', (_name, buildConfig) => {
    const config = JSON.parse(buildConfig([tuicNode, anytlsNode])) as {
      dns: { servers: Array<Record<string, unknown>>; rules: Array<Record<string, unknown>> };
      inbounds?: Array<Record<string, unknown>>;
      outbounds: Array<Record<string, unknown>>;
      route: { rules: Array<Record<string, unknown>> };
    };

    expect(config.dns.servers.every((server) => typeof server.type === 'string')).toBe(true);
    expect(config.dns.servers.every((server) => server.address === undefined)).toBe(true);
    expect(config.dns.rules.every((rule) => typeof rule.action === 'string')).toBe(true);
    expect(config.outbounds).not.toContainEqual(expect.objectContaining({ type: 'block' }));
    expect(config.outbounds).not.toContainEqual(expect.objectContaining({ type: 'dns' }));
    expect(config.route.rules.every((rule) => typeof rule.action === 'string')).toBe(true);

    for (const inbound of config.inbounds ?? []) {
      expect(inbound.sniff).toBeUndefined();
      expect(inbound.sniff_override_destination).toBeUndefined();
      expect(inbound.domain_strategy).toBeUndefined();
    }
  });
});

describe('sing-box 1.13 native config validation', () => {
  const version = spawnSync('sing-box', ['version'], { encoding: 'utf8' });
  const nativeIt = version.status === 0 ? it : it.skip;

  nativeIt.each([
    ['full sing-box', buildFullSingboxConfig],
    ['HomeProxy', buildHomeProxyConfig],
  ])('%s passes sing-box check without deprecated feature flags', (_name, buildConfig) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('ENABLE_DEPRECATED_')),
    );
    const validTuic = {
      ...tuicNode,
      credentials: {
        ...tuicNode.credentials,
        uuid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      },
    };
    const result = spawnSync('sing-box', ['check', '-c', '/dev/stdin'], {
      encoding: 'utf8',
      env,
      input: buildConfig([validTuic, anytlsNode]),
    });

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/deprecated/i);
  });
});

describe('buildHiddifyDeepLink', () => {
  it('uses the raw subscription URL expected by Hiddify', () => {
    const subscriptionUrl = 'https://panel.example.com/api/subscriptions/link/token/singbox';

    expect(buildHiddifyDeepLink(subscriptionUrl)).toBe(`hiddify://import/${subscriptionUrl}`);
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

  it('preserves insecure TLS for existing self-signed Hysteria2 nodes', () => {
    const out = buildSingboxOutbound(hy2Node) as Record<string, unknown>;
    const tls = out.tls as Record<string, unknown>;
    expect(tls.insecure).toBe(true);
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
    ['VLESS+XHTTP+REALITY', xhttpVless],
    ['TUIC', tuicNode],
    ['AnyTLS', anytlsNode],
  ])('%s 输出 udp: true', (_name, node) => {
    const yaml = buildClashProxy(node)!;
    expect(yaml).toContain('udp: true');
  });
});
