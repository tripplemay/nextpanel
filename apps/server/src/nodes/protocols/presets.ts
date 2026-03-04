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
  | 'HYSTERIA2'
  | 'SHADOWSOCKS';

/** Array form for use in IsIn() validators */
export const SUPPORTED_PROTOCOLS: SupportedProtocol[] = [
  'VLESS_REALITY',
  'VLESS_WS_TLS',
  'HYSTERIA2',
  'SHADOWSOCKS',
];

export interface ProtocolPreset {
  /** Display name shown in UI */
  label: string;
  /** Brief description shown in UI */
  description: string;
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
    protocol: 'VLESS',
    implementation: 'XRAY',
    transport: 'TCP',
    tls: 'REALITY',
    fixedPort: null,
  },
  VLESS_WS_TLS: {
    label: 'VLESS + WS + TLS',
    description: '经 Cloudflare CDN 中转，IP 被封时的保底方案',
    protocol: 'VLESS',
    implementation: 'XRAY',
    transport: 'WS',
    tls: 'TLS',
    fixedPort: 443,
  },
  HYSTERIA2: {
    label: 'Hysteria2',
    description: '基于 QUIC/UDP，速度极快',
    protocol: 'HYSTERIA2',
    implementation: 'SING_BOX',
    transport: null,
    tls: 'TLS',
    fixedPort: null,
  },
  SHADOWSOCKS: {
    label: 'Shadowsocks 2022',
    description: '轻量备用，配置简单',
    protocol: 'SHADOWSOCKS',
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
  HYSTERIA2: () => ({
    password: randomPassword(32),
  }),
  SHADOWSOCKS: () => ({
    password: randomPassword(32),
    method: 'aes-256-gcm',
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
