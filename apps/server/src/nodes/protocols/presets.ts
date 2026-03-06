/**
 * Protocol presets — each supported protocol has exactly ONE optimal
 * implementation path.  All fields are auto-populated on node creation;
 * the user only selects the protocol name.
 *
 * Adding a new protocol:
 *  1. Add an entry to PROTOCOL_PRESETS
 *  2. Add a credential generator to CREDENTIAL_GENERATORS
 *  3. Add a config generator (xray-config.ts or singbox-config.ts)
 *  4. Add subscription builders in uri-builder.ts
 */

import * as crypto from 'crypto';

// ─── Preset definition ───────────────────────────────────────────────────────

export type SupportedProtocol =
  | 'VLESS_REALITY'
  | 'VLESS_WS_TLS'
  | 'VLESS_TCP_TLS'
  | 'HYSTERIA2'
  | 'VMESS_TCP';

/** Array form for use in IsIn() validators */
export const SUPPORTED_PROTOCOLS: SupportedProtocol[] = [
  'VLESS_REALITY',
  'VLESS_WS_TLS',
  'VLESS_TCP_TLS',
  'HYSTERIA2',
  'VMESS_TCP',
];

export interface PresetTag {
  text: string;
  color: string;
}

export interface ProtocolPreset {
  /** Display name shown in UI */
  label: string;
  /** Brief description shown in UI */
  description: string;
  /** Colored tags for speed / security / config cost */
  tags: PresetTag[];
  /** Prisma Protocol enum value */
  protocol: string;
  /** Prisma Implementation enum value */
  implementation: string;
  /** Prisma Transport enum value — null for Hysteria2 */
  transport: string | null;
  /** Prisma TlsMode enum value */
  tls: string;
  /** Fixed listen port — null means random */
  fixedPort: number | null;
}

export const PROTOCOL_PRESETS: Record<SupportedProtocol, ProtocolPreset> = {
  VLESS_REALITY: {
    label: 'VLESS + REALITY',
    description: '裸 IP 直连，抗识别能力最强，首选方案',
    tags: [
      { text: '极速', color: 'green' },
      { text: '抗识别最强', color: 'red' },
      { text: '无需域名', color: 'blue' },
    ],
    protocol: 'VLESS',
    implementation: 'XRAY',
    transport: 'TCP',
    tls: 'REALITY',
    fixedPort: null,
  },
  VLESS_WS_TLS: {
    label: 'VLESS + WS + TLS',
    description: '经 Cloudflare CDN 中转，IP 被封时的保底方案',
    tags: [
      { text: '中速', color: 'orange' },
      { text: '高安全', color: 'volcano' },
      { text: '需要 CF + 域名', color: 'gold' },
    ],
    protocol: 'VLESS',
    implementation: 'XRAY',
    transport: 'WS',
    tls: 'TLS',
    fixedPort: 443,
  },
  VLESS_TCP_TLS: {
    label: 'VLESS + TCP + TLS',
    description: '直连，真实 TLS 证书，兼容不支持 REALITY 的客户端（Quantumult X 等）',
    tags: [
      { text: '快', color: 'green' },
      { text: '高安全', color: 'volcano' },
      { text: '需要域名', color: 'gold' },
    ],
    protocol: 'VLESS',
    implementation: 'XRAY',
    transport: 'TCP',
    tls: 'TLS',
    fixedPort: null,
  },
  HYSTERIA2: {
    label: 'Hysteria2',
    description: '基于 QUIC/UDP，速度极快',
    tags: [
      { text: '极速', color: 'green' },
      { text: '高安全', color: 'volcano' },
      { text: '无需域名', color: 'blue' },
    ],
    protocol: 'HYSTERIA2',
    implementation: 'SING_BOX',
    transport: null,
    tls: 'TLS',
    fixedPort: null,
  },
  VMESS_TCP: {
    label: 'VMess + TCP',
    description: '兼容性最广的兜底方案，无需域名或证书，适合老旧客户端',
    tags: [
      { text: '快', color: 'green' },
      { text: '基础加密', color: 'default' },
      { text: '无需域名/证书', color: 'blue' },
    ],
    protocol: 'VMESS',
    implementation: 'XRAY',
    transport: 'TCP',
    tls: 'NONE',
    fixedPort: null,
  },
};

// ─── Credential generators ───────────────────────────────────────────────────

export type GeneratedCredentials = Record<string, string>;

export const CREDENTIAL_GENERATORS: Record<
  SupportedProtocol,
  () => GeneratedCredentials
> = {
  VLESS_REALITY: () => {
    const { realityPrivateKey, realityPublicKey } = generateX25519Keys();
    return {
      uuid: crypto.randomUUID(),
      realityPrivateKey,
      realityPublicKey,
    };
  },
  VLESS_WS_TLS: () => ({
    uuid: crypto.randomUUID(),
  }),
  VLESS_TCP_TLS: () => ({
    uuid: crypto.randomUUID(),
  }),
  HYSTERIA2: () => ({
    password: randomPassword(32),
  }),
  VMESS_TCP: () => ({
    uuid: crypto.randomUUID(),
  }),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomPassword(length: number): string {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

/**
 * Generate an X25519 key pair in Xray's base64url format.
 * PKCS8 DER for X25519: 48 bytes, raw key starts at offset 16.
 * SPKI  DER for X25519: 44 bytes, raw key starts at offset 12.
 */
function generateX25519Keys(): {
  realityPrivateKey: string;
  realityPublicKey: string;
} {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer;
  const pubDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  return {
    realityPrivateKey: privDer.slice(16).toString('base64url'),
    realityPublicKey: pubDer.slice(12).toString('base64url'),
  };
}
