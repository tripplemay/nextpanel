/**
 * Pure functions for building proxy share URIs, Clash YAML proxies, and Sing-box outbounds.
 * No IO, no side effects.
 */

export interface NodeExportInfo {
  name: string;
  protocol: string;
  host: string;
  port: number;
  transport: string | null;
  tls: string;
  domain: string | null;
  credentials: Record<string, string>;
  /** ISO 3166-1 alpha-2 country code of the actual exit server (chain nodes use exit server's country) */
  countryCode?: string | null;
}

import { REALITY_DEFAULT_SNI, REALITY_FLOW } from '../nodes/protocols/reality';

// ─── Share URI (vmess://, vless://, etc.) ────────────────────────────────────

export function buildShareUri(node: NodeExportInfo): string | null {
  const { protocol, host, port, name, transport, tls, domain, credentials: creds } = node;
  const tag = encodeURIComponent(name);
  const net = toClashNet(transport);

  switch (protocol) {
    case 'VMESS': {
      const obj: Record<string, string> = {
        v: '2',
        ps: name,
        add: host,
        port: String(port),
        id: creds.uuid ?? '',
        aid: '0',
        scy: 'auto',
        net,
        type: 'none',
        host: domain ?? '',
        path: net === 'ws' ? '/' : net === 'grpc' ? 'grpc' : '',
        tls: tls === 'TLS' ? 'tls' : tls === 'REALITY' ? 'reality' : '',
        sni: domain ?? '',
      };
      return `vmess://${Buffer.from(JSON.stringify(obj)).toString('base64')}`;
    }

    case 'VLESS': {
      const params = new URLSearchParams({ encryption: 'none' });
      if (tls === 'REALITY') params.set('flow', REALITY_FLOW);
      addTransportParams(params, net, domain);
      addTlsParams(params, tls, domain, creds);
      return `vless://${creds.uuid ?? ''}@${host}:${port}?${params.toString()}#${tag}`;
    }

    case 'TROJAN': {
      const params = new URLSearchParams();
      addTransportParams(params, net, domain);
      addTlsParams(params, tls, domain, creds);
      const qs = params.toString();
      return `trojan://${creds.password ?? ''}@${host}:${port}${qs ? '?' + qs : ''}#${tag}`;
    }

    case 'SHADOWSOCKS': {
      const method = creds.method ?? 'aes-256-gcm';
      const userInfo = Buffer.from(`${method}:${creds.password ?? ''}`).toString('base64');
      return `ss://${userInfo}@${host}:${port}#${tag}`;
    }

    case 'HYSTERIA2': {
      // hy2://password@host:port?sni=domain#name
      const params = new URLSearchParams();
      if (domain) params.set('sni', domain);
      const qs = params.toString();
      return `hy2://${encodeURIComponent(creds.password ?? '')}@${host}:${port}${qs ? '?' + qs : ''}#${tag}`;
    }

    case 'SOCKS5':
      return `socks5://${host}:${port}#${tag}`;

    case 'HTTP':
      return `http://${host}:${port}#${tag}`;

    default:
      return null;
  }
}

// ─── Clash YAML proxy entry ───────────────────────────────────────────────────

export function buildClashProxy(node: NodeExportInfo): string | null {
  const { protocol, host, port, name, transport, tls, domain, credentials: creds } = node;
  const net = toClashNet(transport);
  const tlsEnabled = tls === 'TLS' || tls === 'REALITY';
  const sni = tls === 'REALITY' ? (domain ?? REALITY_DEFAULT_SNI) : (domain ?? '');

  const lines: string[] = [];

  function add(key: string, value: string | number | boolean) {
    lines.push(`    ${key}: ${yamlScalar(value)}`);
  }

  lines.push(`  - name: ${yamlScalar(name)}`);

  switch (protocol) {
    case 'VMESS': {
      add('type', 'vmess');
      add('server', host);
      add('port', port);
      add('uuid', creds.uuid ?? '');
      add('alterId', 0);
      add('cipher', 'auto');
      add('network', net);
      if (tls === 'REALITY') add('flow', REALITY_FLOW);
      if (tlsEnabled) add('tls', true);
      if (sni) add('servername', sni);
      if (net === 'ws') {
        lines.push(`    ws-opts:`);
        lines.push(`      path: /`);
        if (sni) lines.push(`      headers:`);
        if (sni) lines.push(`        Host: ${sni}`);
      } else if (net === 'grpc') {
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: grpc`);
      }
      if (tls === 'REALITY') {
        lines.push(`    client-fingerprint: chrome`);
        lines.push(`    reality-opts:`);
        lines.push(`      public-key: ${creds.realityPublicKey ?? ''}`);
        lines.push(`      short-id: ""`);
      }
      add('udp', true);
      break;
    }

    case 'VLESS': {
      add('type', 'vless');
      add('server', host);
      add('port', port);
      add('uuid', creds.uuid ?? '');
      add('network', net);
      if (tls === 'REALITY') add('flow', REALITY_FLOW);
      if (tlsEnabled) add('tls', true);
      if (sni) add('servername', sni);
      if (net === 'ws') {
        lines.push(`    ws-opts:`);
        lines.push(`      path: /`);
      } else if (net === 'grpc') {
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: grpc`);
      }
      if (tls === 'REALITY') {
        lines.push(`    client-fingerprint: chrome`);
        lines.push(`    reality-opts:`);
        lines.push(`      public-key: ${creds.realityPublicKey ?? ''}`);
        lines.push(`      short-id: ""`);
      }
      add('udp', true);
      break;
    }

    case 'TROJAN': {
      add('type', 'trojan');
      add('server', host);
      add('port', port);
      add('password', creds.password ?? '');
      add('tls', true);
      if (sni) add('sni', sni);
      add('network', net);
      if (net === 'ws') {
        lines.push(`    ws-opts:`);
        lines.push(`      path: /`);
      } else if (net === 'grpc') {
        lines.push(`    grpc-opts:`);
        lines.push(`      grpc-service-name: grpc`);
      }
      add('udp', true);
      break;
    }

    case 'SHADOWSOCKS': {
      add('type', 'ss');
      add('server', host);
      add('port', port);
      add('cipher', creds.method ?? 'aes-256-gcm');
      add('password', creds.password ?? '');
      add('udp', true);
      break;
    }

    case 'HYSTERIA2': {
      add('type', 'hysteria2');
      add('server', host);
      add('port', port);
      add('password', creds.password ?? '');
      if (domain) add('sni', domain);
      add('skip-cert-verify', true);
      break;
    }

    case 'SOCKS5': {
      add('type', 'socks5');
      add('server', host);
      add('port', port);
      if (creds.username) add('username', creds.username);
      if (creds.password) add('password', creds.password);
      add('udp', true);
      break;
    }

    case 'HTTP': {
      add('type', 'http');
      add('server', host);
      add('port', port);
      if (creds.username) add('username', creds.username);
      if (creds.password) add('password', creds.password);
      break;
    }

    default:
      return null;
  }

  return lines.join('\n');
}

// ─── Sing-box outbound ────────────────────────────────────────────────────────

export function buildSingboxOutbound(node: NodeExportInfo): Record<string, unknown> | null {
  const { protocol, host, port, name, transport, tls, domain, credentials: creds } = node;
  const tlsObj = buildSingboxTls(tls, domain, creds);
  const transportObj = buildSingboxTransport(transport);

  switch (protocol) {
    case 'VMESS':
      return {
        type: 'vmess',
        tag: name,
        server: host,
        server_port: port,
        uuid: creds.uuid ?? '',
        security: 'auto',
        alter_id: 0,
        ...(transportObj ? { transport: transportObj } : {}),
        ...(tlsObj ? { tls: tlsObj } : {}),
      };

    case 'VLESS':
      return {
        type: 'vless',
        tag: name,
        server: host,
        server_port: port,
        uuid: creds.uuid ?? '',
        ...(tls === 'REALITY' ? { flow: REALITY_FLOW } : {}),
        ...(transportObj ? { transport: transportObj } : {}),
        ...(tlsObj ? { tls: tlsObj } : {}),
      };

    case 'TROJAN':
      return {
        type: 'trojan',
        tag: name,
        server: host,
        server_port: port,
        password: creds.password ?? '',
        ...(transportObj ? { transport: transportObj } : {}),
        ...(tlsObj ? { tls: tlsObj } : { tls: { enabled: true } }),
      };

    case 'SHADOWSOCKS':
      return {
        type: 'shadowsocks',
        tag: name,
        server: host,
        server_port: port,
        method: creds.method ?? 'aes-256-gcm',
        password: creds.password ?? '',
      };

    case 'SOCKS5': {
      const out: Record<string, unknown> = {
        type: 'socks',
        tag: name,
        server: host,
        server_port: port,
        version: '5',
      };
      if (creds.username) out.username = creds.username;
      if (creds.password) out.password = creds.password;
      return out;
    }

    case 'HYSTERIA2':
      return {
        type: 'hysteria2',
        tag: name,
        server: host,
        server_port: port,
        password: creds.password ?? '',
        tls: { enabled: true, insecure: true, ...(domain ? { server_name: domain } : {}) },
      };

    case 'HTTP':
      return {
        type: 'http',
        tag: name,
        server: host,
        server_port: port,
        ...(creds.username ? { username: creds.username, password: creds.password ?? '' } : {}),
      };

    default:
      return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toClashNet(transport: string | null): string {
  const map: Record<string, string> = { WS: 'ws', GRPC: 'grpc', QUIC: 'quic', TCP: 'tcp' };
  return map[transport ?? 'TCP'] ?? 'tcp';
}

function addTransportParams(params: URLSearchParams, net: string, domain: string | null) {
  params.set('type', net);
  if (net === 'ws') {
    params.set('path', '/');
    if (domain) params.set('host', domain);
  } else if (net === 'grpc') {
    params.set('serviceName', 'grpc');
  }
}

function addTlsParams(
  params: URLSearchParams,
  tls: string,
  domain: string | null,
  creds: Record<string, string>,
) {
  if (tls === 'TLS') {
    params.set('security', 'tls');
    if (domain) params.set('sni', domain);
  } else if (tls === 'REALITY') {
    params.set('security', 'reality');
    params.set('pbk', creds.realityPublicKey ?? '');
    params.set('sid', '');
    params.set('fp', 'chrome');
    // sni must match serverNames in the Xray server config; default to www.google.com
    params.set('sni', domain ?? REALITY_DEFAULT_SNI);
  } else {
    params.set('security', 'none');
  }
}

function buildSingboxTls(
  tls: string,
  domain: string | null,
  creds: Record<string, string>,
): Record<string, unknown> | null {
  if (tls === 'TLS') {
    return { enabled: true, ...(domain ? { server_name: domain } : {}) };
  }
  if (tls === 'REALITY') {
    return {
      enabled: true,
      server_name: domain ?? REALITY_DEFAULT_SNI,
      reality: {
        enabled: true,
        public_key: creds.realityPublicKey ?? '',
        short_id: '',
      },
      utls: { enabled: true, fingerprint: 'chrome' },
    };
  }
  return null;
}

function buildSingboxTransport(transport: string | null): Record<string, unknown> | null {
  switch (transport) {
    case 'WS':
      return { type: 'ws', path: '/' };
    case 'GRPC':
      return { type: 'grpc', service_name: 'grpc' };
    case 'QUIC':
      return { type: 'quic' };
    default:
      return null;
  }
}

/** Escape a scalar value for YAML (quote strings with special characters). */
function yamlScalar(v: string | number | boolean): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === '') return '""';
  // Quote if contains YAML special characters
  if (/[:{}\[\],#&*?|<>=!%@`'"\\]/.test(v) || /^\s|\s$/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

// ─── Full Sing-box subscription JSON ─────────────────────────────────────────

export function buildFullSingboxConfig(nodes: NodeExportInfo[]): string {
  const outbounds = nodes
    .map((n) => buildSingboxOutbound(n))
    .filter((o): o is Record<string, unknown> => o !== null);

  const proxyTags = outbounds.map((o) => o.tag as string);

  const config = {
    log: { level: 'info' },
    dns: {
      servers: [
        { tag: 'proxy-dns', address: 'https://8.8.8.8/dns-query', detour: '🚀 节点选择' },
        { tag: 'direct-dns', address: 'https://223.5.5.5/dns-query', detour: 'direct' },
        { tag: 'block-dns', address: 'rcode://success' },
      ],
      rules: [
        { rule_set: ['geosite-category-ads-all'], server: 'block-dns' },
        { rule_set: ['geosite-cn'], server: 'direct-dns' },
      ],
      strategy: 'prefer_ipv4',
    },
    outbounds: [
      ...outbounds,
      {
        type: 'urltest',
        tag: '⚡ 自动选择',
        outbounds: proxyTags.length > 0 ? proxyTags : ['direct'],
        url: 'http://www.gstatic.com/generate_204',
        interval: '5m',
      },
      {
        type: 'selector',
        tag: '🚀 节点选择',
        outbounds: proxyTags.length > 0 ? ['⚡ 自动选择', ...proxyTags] : ['direct'],
        default: '⚡ 自动选择',
      },
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
      { type: 'dns', tag: 'dns-out' },
    ],
    route: {
      rule_set: [
        { tag: 'geosite-cn', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs' },
        { tag: 'geoip-cn', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs' },
        { tag: 'geosite-category-ads-all', type: 'remote', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs' },
      ],
      rules: [
        { protocol: 'dns', outbound: 'dns-out' },
        { rule_set: ['geosite-category-ads-all'], outbound: 'block' },
        { rule_set: ['geosite-cn'], outbound: 'direct' },
        { rule_set: ['geoip-cn'], outbound: 'direct' },
        { ip_is_private: true, outbound: 'direct' },
      ],
      final: '🚀 节点选择',
      auto_detect_interface: true,
    },
  };

  return JSON.stringify(config, null, 2);
}

// ─── AI Service Domains (inline routing rules) ───────────────────────────────

/**
 * Domain suffix patterns — one entry covers ALL subdomains of a vendor's
 * dedicated domain (e.g. "openai.com" matches api.openai.com, sora.openai.com …).
 * Update this list when new major AI services or domains emerge.
 */
const AI_DOMAIN_SUFFIX: string[] = [
  // OpenAI ecosystem
  'openai.com', 'chatgpt.com', 'oaiusercontent.com', 'oaistatic.com', 'sora.com',
  // Anthropic / Claude
  'anthropic.com', 'claude.ai', 'claudeusercontent.com',
  // Perplexity
  'perplexity.ai',
  // Midjourney
  'midjourney.com',
  // Hugging Face
  'huggingface.co', 'hf.co',
  // Groq
  'groq.com',
  // Together AI
  'together.ai',
  // xAI / Grok
  'x.ai',
  // Mistral AI
  'mistral.ai',
  // Cohere
  'cohere.com', 'cohere.ai',
  // Stability AI
  'stability.ai',
  // ElevenLabs
  'elevenlabs.io',
  // Replicate
  'replicate.com', 'replicate.delivery',
  // Character.AI
  'character.ai', 'c.ai',
  // Poe
  'poe.com',
  // Runway ML
  'runwayml.com',
  // Fireworks AI
  'fireworks.ai',
  // DeepSeek (international API)
  'deepseek.com',
  // Inflection AI (Pi)
  'inflection.ai', 'pi.ai',
  // AI21 Labs
  'ai21.com',
  // Aleph Alpha
  'aleph-alpha.com',
  // Modal
  'modal.com',
  // Moonshot AI / Kimi (international access)
  'moonshot.ai', 'kimi.ai',
];

/**
 * Exact domain matches — for AI services that share infrastructure domains
 * with non-AI products (e.g. googleapis.com, microsoft.com).
 * Must be precise to avoid unintentionally proxying unrelated traffic.
 */
const AI_DOMAIN_EXACT: string[] = [
  // Google Gemini API (shares googleapis.com with all Google services)
  'generativelanguage.googleapis.com',
  'aistudio.google.com',
  'makersuite.google.com',
  // Microsoft Copilot (shares microsoft.com / bing.com)
  'copilot.microsoft.com',
  'sydney.bing.com',
  'edgeservices.bing.com',
  'copilot.bing.com',
];

// ─── Remote rule_set definitions (jsDelivr CDN — accessible in China) ────────

const CDN = 'https://cdn.jsdelivr.net/gh';

const HOMEPROXY_RULE_SETS = [
  { tag: 'geosite-cn',               url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-cn.srs` },
  { tag: 'geoip-cn',                 url: `${CDN}/SagerNet/sing-geoip@rule-set/geoip-cn.srs` },
  { tag: 'geosite-category-ads-all', url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-category-ads-all.srs` },
  { tag: 'geosite-netflix',          url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-netflix.srs` },
  { tag: 'geosite-youtube',          url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-youtube.srs` },
  { tag: 'geosite-disneyplus',       url: `${CDN}/SagerNet/sing-geosite@rule-set/geosite-disneyplus.srs` },
] as const;

// ─── HomeProxy / OpenWrt router sing-box config ───────────────────────────────

/**
 * Generates a complete sing-box JSON configuration for router-level transparent
 * proxy via HomeProxy on OpenWrt. Includes:
 *   - tproxy inbound (port 7895) for iptables-based traffic interception
 *   - mixed inbound (port 7890) for HTTP/SOCKS5
 *   - Full routing: ads block → AI services → streaming → CN direct → proxy
 *   - Split DNS: CN domains → 223.5.5.5 direct, others → 1.1.1.1 via proxy
 *   - Remote rule_sets via jsDelivr CDN (auto-update daily)
 *   - Inline AI service rules (domain_suffix + exact domain)
 */
export function buildHomeProxyConfig(nodes: NodeExportInfo[]): string {
  const outbounds = nodes
    .map((n) => buildSingboxOutbound(n))
    .filter((o): o is Record<string, unknown> => o !== null);

  const proxyTags = outbounds.map((o) => o.tag as string);
  const hasNodes = proxyTags.length > 0;
  const fallback = hasNodes ? proxyTags : ['direct'];

  const config = {
    log: { level: 'warn', timestamp: true },

    dns: {
      servers: [
        // Resolver for bootstrap (no detour — prevents circular dependency)
        { tag: 'dns-local', address: '223.5.5.5', detour: 'direct' },
        // CN domains: DoH via Alibaba, always direct
        {
          tag: 'dns-direct',
          address: 'https://223.5.5.5/dns-query',
          address_resolver: 'dns-local',
          detour: 'direct',
        },
        // Foreign domains: DNS over TLS via 1.1.1.1, routed through proxy
        { tag: 'dns-proxy', address: 'tls://1.1.1.1', detour: '🚀 节点选择' },
        // Ad domains: refused
        { tag: 'dns-block', address: 'rcode://refused' },
      ],
      rules: [
        // Bootstrap: proxy server address resolution must bypass the proxy itself
        { outbound: 'any', server: 'dns-local' },
        // Block ads at DNS level
        { rule_set: ['geosite-category-ads-all'], server: 'dns-block' },
        // CN domains use domestic DNS
        { rule_set: ['geosite-cn'], server: 'dns-direct' },
      ],
      final: 'dns-proxy',
      strategy: 'prefer_ipv4',
      independent_cache: true,
    },

    inbounds: [
      {
        // Transparent proxy — receives traffic redirected by iptables/nftables
        type: 'tproxy',
        tag: 'tproxy-in',
        listen: '::',
        listen_port: 7895,
        sniff: true,
        sniff_override_destination: true,
        domain_strategy: 'prefer_ipv4',
      },
      {
        // HTTP/SOCKS5 proxy for devices that don't support tproxy
        type: 'mixed',
        tag: 'mixed-in',
        listen: '::',
        listen_port: 7890,
        sniff: true,
        domain_strategy: 'prefer_ipv4',
      },
    ],

    outbounds: [
      ...outbounds,
      {
        type: 'urltest',
        tag: '⚡ 自动选择',
        outbounds: fallback,
        url: 'https://www.gstatic.com/generate_204',
        interval: '5m',
        tolerance: 50,
      },
      {
        type: 'selector',
        tag: '🚀 节点选择',
        outbounds: hasNodes ? ['⚡ 自动选择', ...proxyTags] : ['direct'],
        default: '⚡ 自动选择',
      },
      {
        type: 'selector',
        tag: '🎬 流媒体',
        outbounds: hasNodes ? ['🚀 节点选择', '⚡ 自动选择', ...proxyTags] : ['direct'],
        default: '🚀 节点选择',
      },
      {
        type: 'selector',
        tag: '🤖 AI 服务',
        outbounds: hasNodes ? ['🚀 节点选择', '⚡ 自动选择', ...proxyTags] : ['direct'],
        default: '🚀 节点选择',
      },
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
      { type: 'dns', tag: 'dns-out' },
    ],

    route: {
      rules: [
        // DNS traffic must go through the DNS outbound
        { protocol: 'dns', outbound: 'dns-out' },
        // LAN / private IPs always go direct
        { ip_is_private: true, outbound: 'direct' },
        // Block ads
        { rule_set: ['geosite-category-ads-all'], outbound: 'block' },
        // AI services — inline domain rules (no external rule_set file needed)
        {
          domain_suffix: AI_DOMAIN_SUFFIX,
          domain: AI_DOMAIN_EXACT,
          outbound: '🤖 AI 服务',
        },
        // Streaming services
        { rule_set: ['geosite-netflix', 'geosite-youtube', 'geosite-disneyplus'], outbound: '🎬 流媒体' },
        // China domains and IPs — direct
        { rule_set: ['geosite-cn', 'geoip-cn'], outbound: 'direct' },
      ],
      rule_set: HOMEPROXY_RULE_SETS.map((rs) => ({
        tag: rs.tag,
        type: 'remote',
        format: 'binary',
        url: rs.url,
        download_detour: 'direct',
        update_interval: '1d',
      })),
      final: '🚀 节点选择',
      auto_detect_interface: true,
    },
  };

  return JSON.stringify(config, null, 2);
}

// ─── Hiddify deep link ──────────────────────────────────────────────────────

/** Build Hiddify deep link from a subscription URL */
export function buildHiddifyDeepLink(subscriptionUrl: string): string {
  return `hiddify://import/${Buffer.from(subscriptionUrl).toString('base64')}`;
}

// ─── Full Clash / Mihomo subscription YAML ───────────────────────────────────

const RULE_NAMES = ['reject', 'proxy', 'direct', 'cncidr', 'telegramcidr', 'netflix', 'youtube', 'apple', 'microsoft', 'openai'] as const;

const RULE_BEHAVIOR: Record<typeof RULE_NAMES[number], string> = {
  reject: 'domain',
  proxy: 'domain',
  direct: 'domain',
  cncidr: 'ipcidr',
  telegramcidr: 'ipcidr',
  netflix: 'classical',
  youtube: 'classical',
  apple: 'classical',
  microsoft: 'classical',
  openai: 'classical',
};

// ─── Country code → flag emoji + display name ──────────────────────────────
const COUNTRY_NAMES: Record<string, string> = {
  US: '🇺🇸 美国', JP: '🇯🇵 日本', HK: '🇭🇰 香港', SG: '🇸🇬 新加坡', TW: '🇹🇼 台湾',
  KR: '🇰🇷 韩国', DE: '🇩🇪 德国', GB: '🇬🇧 英国', FR: '🇫🇷 法国', NL: '🇳🇱 荷兰',
  CA: '🇨🇦 加拿大', AU: '🇦🇺 澳大利亚', IN: '🇮🇳 印度', RU: '🇷🇺 俄罗斯', BR: '🇧🇷 巴西',
  TR: '🇹🇷 土耳其', TH: '🇹🇭 泰国', PH: '🇵🇭 菲律宾', MY: '🇲🇾 马来西亚', ID: '🇮🇩 印尼',
  VN: '🇻🇳 越南', AR: '🇦🇷 阿根廷', CL: '🇨🇱 智利', MX: '🇲🇽 墨西哥', ZA: '🇿🇦 南非',
  AE: '🇦🇪 阿联酋', IT: '🇮🇹 意大利', ES: '🇪🇸 西班牙', SE: '🇸🇪 瑞典', CH: '🇨🇭 瑞士',
  FI: '🇫🇮 芬兰', PL: '🇵🇱 波兰', IE: '🇮🇪 爱尔兰', NO: '🇳🇴 挪威', DK: '🇩🇰 丹麦',
};

function countryDisplayName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? `🌐 ${code.toUpperCase()}`;
}

export function buildClashSubscription(nodes: NodeExportInfo[], panelUrl: string): string {
  // Build proxy entries; keep only successful ones
  const proxyEntries: { name: string; yaml: string; countryCode?: string | null }[] = [];
  for (const node of nodes) {
    const yaml = buildClashProxy(node);
    if (yaml !== null) proxyEntries.push({ name: node.name, yaml, countryCode: node.countryCode });
  }

  const nodeNames = proxyEntries.map((e) => e.name);

  // ── Group nodes by country code ──────────────────────────────────────────
  const regionMap = new Map<string, string[]>(); // countryCode → node names
  for (const entry of proxyEntries) {
    const cc = entry.countryCode?.toUpperCase();
    if (!cc) continue;
    if (!regionMap.has(cc)) regionMap.set(cc, []);
    regionMap.get(cc)!.push(entry.name);
  }
  // Sort regions by node count (descending) for stable port assignment
  const regionEntries = [...regionMap.entries()].sort((a, b) => b[1].length - a[1].length);

  // ── rule-providers ────────────────────────────────────────────────────────
  const base = panelUrl.replace(/\/$/, '');
  const ruleProviderLines: string[] = ['rule-providers:'];
  for (const name of RULE_NAMES) {
    ruleProviderLines.push(
      `  ${name}:`,
      `    type: http`,
      `    behavior: ${RULE_BEHAVIOR[name]}`,
      `    url: "${base}/api/rules/${name}"`,
      `    interval: 86400`,
    );
  }

  // ── proxies ───────────────────────────────────────────────────────────────
  const proxiesSection =
    proxyEntries.length === 0
      ? 'proxies: []'
      : ['proxies:', ...proxyEntries.map((e) => e.yaml)].join('\n');

  // ── proxy-groups ──────────────────────────────────────────────────────────
  function nodeList(prefix: string[] = [], names: string[] = nodeNames): string {
    return [...prefix, ...names].map((n) => `      - ${yamlScalar(n)}`).join('\n');
  }

  const groups: string[] = [
    // ── Core groups (existing) ──
    [
      '  - name: 🚀 节点选择',
      '    type: select',
      '    proxies:',
      nodeList(['⚡ 自动选择']),
    ].join('\n'),
    [
      '  - name: ⚡ 自动选择',
      '    type: url-test',
      '    url: http://www.gstatic.com/generate_204',
      '    interval: 300',
      '    proxies:',
      nodeList(),
    ].join('\n'),
    // ── Use-case groups ──
    ...([
      ['🎬 流媒体', '🚀 节点选择'],
      ['🤖 AI 服务', '🚀 节点选择'],
      ['📱 Telegram', '🚀 节点选择'],
    ] as [string, string][]).map(([groupName, def]) =>
      [
        `  - name: ${groupName}`,
        '    type: select',
        '    proxies:',
        nodeList([def]),
      ].join('\n'),
    ),
    ...([
      ['🍎 Apple', 'DIRECT'],
      ['🪟 Microsoft', 'DIRECT'],
    ] as [string, string][]).map(([groupName, def]) =>
      [
        `  - name: ${groupName}`,
        '    type: select',
        '    proxies:',
        nodeList([def, '🚀 节点选择']),
      ].join('\n'),
    ),
    [
      '  - name: 🐟 漏网之鱼',
      '    type: select',
      '    proxies:',
      nodeList(['🚀 节点选择', 'DIRECT']),
    ].join('\n'),
  ];

  // ── Region groups (dynamic, only for countries with nodes) ──
  for (const [cc, names] of regionEntries) {
    const displayName = countryDisplayName(cc);
    groups.push(
      [
        `  - name: ${displayName}`,
        '    type: select',
        '    proxies:',
        nodeList([], names),
      ].join('\n'),
    );
  }

  const proxyGroupsSection = ['proxy-groups:', ...groups].join('\n');

  // ── listeners (multi-port for per-terminal routing) ───────────────────────
  const listeners: string[] = [];

  // Port 7890: main entry with rule-based routing (implicit via mixed-port, but
  // we use explicit listener so all ports appear together in the config)
  listeners.push(
    '  - name: mixed-main',
    '    type: mixed',
    '    port: 7890',
  );

  // Ports 7891+: one per region
  let regionPort = 7891;
  for (const [cc] of regionEntries) {
    const displayName = countryDisplayName(cc);
    listeners.push(
      `  - name: mixed-${cc.toLowerCase()}`,
      `    type: mixed`,
      `    port: ${regionPort}`,
      `    proxy: ${yamlScalar(displayName)}`,
    );
    regionPort++;
  }

  // Ports 7901+: use-case groups
  const useCaseListeners: [number, string][] = [
    [7901, '🎬 流媒体'],
    [7902, '🤖 AI 服务'],
  ];
  for (const [port, groupName] of useCaseListeners) {
    listeners.push(
      `  - name: mixed-${port}`,
      `    type: mixed`,
      `    port: ${port}`,
      `    proxy: ${yamlScalar(groupName)}`,
    );
  }

  const listenersSection = ['listeners:', ...listeners].join('\n');

  // ── rules ─────────────────────────────────────────────────────────────────
  const rulesSection = [
    'rules:',
    '  - RULE-SET,reject,REJECT',
    '  - RULE-SET,netflix,🎬 流媒体',
    '  - RULE-SET,youtube,🎬 流媒体',
    '  - RULE-SET,apple,🍎 Apple',
    '  - RULE-SET,microsoft,🪟 Microsoft',
    '  - RULE-SET,telegramcidr,📱 Telegram',
    '  - RULE-SET,openai,🤖 AI 服务',
    '  - RULE-SET,proxy,🚀 节点选择',
    '  - RULE-SET,direct,DIRECT',
    '  - RULE-SET,cncidr,DIRECT',
    '  - GEOIP,LAN,DIRECT',
    '  - GEOIP,CN,DIRECT',
    '  - MATCH,🐟 漏网之鱼',
  ].join('\n');

  // ── top-level config ──────────────────────────────────────────────────────
  const topLevel = [
    'mode: rule',
    'log-level: info',
  ].join('\n');

  return [
    topLevel,
    '',
    listenersSection,
    '',
    ruleProviderLines.join('\n'),
    '',
    proxiesSection,
    '',
    proxyGroupsSection,
    '',
    rulesSection,
    '',
  ].join('\n');
}
