/**
 * Pure-function config generators — no IO, no side effects.
 * Returns a JSON string ready to be written to the remote server.
 */

import { generateXrayConfig } from './xray-config';
import { generateSingBoxConfig, generateSsLibevConfig } from './singbox-config';

export interface NodeInfo {
  id: string;
  protocol: string;         // VMESS | VLESS | TROJAN | SHADOWSOCKS | SOCKS5 | HTTP | HYSTERIA2
  implementation: string | null; // XRAY | V2RAY | SING_BOX | SS_LIBEV | null
  transport: string | null; // TCP | WS | GRPC | QUIC
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
}

export interface NodeCredentials {
  uuid?: string;
  password?: string;
  method?: string;
  username?: string;
  realityPrivateKey?: string;
  realityPublicKey?: string;
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
 * B runs a minimal VLESS(no TLS) inbound + freedom outbound with IP whitelist.
 */
export function generateChainExitConfig(
  nodeId: string,
  exitPort: number,
  chainUuid: string,
  entryServerIp: string,
): string {
  return JSON.stringify(
    {
      log: { loglevel: 'warning' },
      inbounds: [
        {
          tag: `chain-in-${nodeId}`,
          port: exitPort,
          listen: '0.0.0.0',
          protocol: 'vless',
          settings: {
            clients: [{ id: chainUuid }],
            decryption: 'none',
          },
          streamSettings: { network: 'tcp', security: 'none' },
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
