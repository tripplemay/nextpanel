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
