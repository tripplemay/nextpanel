/**
 * Pure-function config generators — no IO, no side effects.
 * Returns a JSON string ready to be written to the remote server.
 */

import { generateXrayConfig } from './xray-config';
import { generateSingBoxConfig, generateSsLibevConfig } from './singbox-config';
import { REALITY_DEFAULT_SNI } from '../protocols/reality';

export interface NodeInfo {
  id: string;
  protocol: string;         // VMESS | VLESS | TROJAN | SHADOWSOCKS | SOCKS5 | HTTP | HYSTERIA2 | TUIC | ANYTLS
  implementation: string | null; // XRAY | V2RAY | SING_BOX | SS_LIBEV | null
  transport: string | null; // TCP | RAW | WS | GRPC | QUIC | XHTTP
  tls: string;              // NONE | TLS | REALITY
  listenPort: number;
  domain: string | null;
  /** xray stats API port — only passed for xray/v2ray nodes during deploy */
  statsPort?: number;
  /** Chain proxy: exit server IP (when set, outbound goes to exit server instead of freedom) */
  chainExitIp?: string;
  /** Chain proxy: exit server port (dokodemo-door / internal VLESS on exit server) */
  chainExitPort?: number;
  /** Chain proxy: UUID for internal VLESS between entry and exit */
  chainUuid?: string;
  /** Chain proxy: REALITY private key installed only on the exit server */
  chainRealityPrivateKey?: string;
  /** Chain proxy: REALITY public key used by the entry server */
  chainRealityPublicKey?: string;
  /** Chain proxy: REALITY short ID shared by entry and exit */
  chainShortId?: string;
}

export interface NodeCredentials {
  uuid?: string;
  password?: string;
  method?: string;
  username?: string;
  realityPrivateKey?: string;
  realityPublicKey?: string;
  shortId?: string;
  path?: string;
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

/**
 * Generate config for the exit server (B) in a chain proxy setup.
 * B runs a minimal VLESS inbound + freedom outbound with IP whitelist.
 * New chains use REALITY; legacy chains without REALITY credentials retain the
 * original plaintext transport for backward compatibility.
 */
export interface ChainRealityCredentials {
  privateKey: string;
  shortId: string;
}

export function generateChainExitConfig(
  nodeId: string,
  exitPort: number,
  chainUuid: string,
  entryServerIp: string,
  reality?: ChainRealityCredentials,
): string {
  if (reality && (!reality.privateKey || !reality.shortId)) {
    throw new Error('Secure chain exit requires a REALITY private key and short ID');
  }

  const streamSettings = reality
    ? {
        network: 'tcp',
        security: 'reality',
        realitySettings: {
          target: `${REALITY_DEFAULT_SNI}:443`,
          serverNames: [REALITY_DEFAULT_SNI],
          privateKey: reality.privateKey,
          shortIds: [reality.shortId],
        },
        sockopt: { tcpKeepAliveInterval: 30 },
      }
    : {
        network: 'tcp',
        security: 'none',
        sockopt: { tcpKeepAliveInterval: 30 },
      };

  return JSON.stringify(
    {
      log: { loglevel: 'warning' },
      inbounds: [
        {
          tag: `chain-in-${nodeId}`,
          port: exitPort,
          listen: '::',
          protocol: 'vless',
          settings: {
            clients: [{ id: chainUuid }],
            decryption: 'none',
          },
          streamSettings,
        },
      ],
      outbounds: [
        { protocol: 'freedom', tag: 'direct' },
        { protocol: 'blackhole', tag: 'blocked' },
      ],
      routing: {
        rules: [
          { type: 'field', source: [entryServerIp], outboundTag: 'direct' },
          { type: 'field', network: 'tcp,udp', outboundTag: 'blocked' },
        ],
      },
    },
    null,
    2,
  );
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
