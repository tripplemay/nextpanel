import { BadRequestException } from '@nestjs/common';

export const CF_XHTTP_MODE = 'packet-up';
export const CF_XHTTP_XRAY_VERSION = '26.10.31';
export type CfXhttpMode = 'packet-up' | 'stream-up';

export function isCfXhttpPreset(preset: string): boolean {
  return preset === 'VLESS_XHTTP_TLS' || preset === 'VLESS_XHTTP_H3_TLS';
}

export function cfXhttpProfile(credentials: Record<string, string | undefined>) {
  const mode = credentials.xhttpMode === undefined ? CF_XHTTP_MODE : credentials.xhttpMode;
  const alpn = credentials.xhttpAlpn === undefined ? 'h2' : credentials.xhttpAlpn;
  if (!['packet-up', 'stream-up'].includes(mode) || !['h2', 'h3'].includes(alpn)
    || (alpn === 'h3' && mode !== 'packet-up')) {
    throw new BadRequestException('Supported CDN XHTTP profiles: H2 packet-up, H2 stream-up, H3 packet-up');
  }
  return { mode, alpn, protocol: alpn === 'h2' && mode === 'packet-up' ? 3 : 4,
    feature: `vless-xhttp-tls-${mode}-${alpn}` };
}

export function applyCfXhttpMode(preset: string, credentials: Record<string, string>, mode?: CfXhttpMode): void {
  if (mode !== undefined && !isCfXhttpPreset(preset)) {
    throw new BadRequestException('xhttpMode is only supported by managed CDN XHTTP presets');
  }
  if (isCfXhttpPreset(preset)) {
    if (mode !== undefined) credentials.xhttpMode = mode;
    cfXhttpProfile(credentials);
  }
}

export function isCfXhttp(node: { protocol: string; transport?: string | null; tls?: string | null }): boolean {
  return node.protocol === 'VLESS' && node.transport === 'XHTTP' && node.tls === 'TLS';
}

export function assertCfXhttpPilotEnabled(): void {
  if (process.env.CF_XHTTP_PILOT_ENABLED !== 'true') {
    throw new BadRequestException('XHTTP CDN pilot is disabled; existing WS nodes are unchanged');
  }
}

// Keep managed CDN profiles smaller than the imported XHTTP feature set.
export function cfXhttpCredentials(credentials: Record<string, string | undefined>, domain: string): Record<string, string> {
  const uuid = credentials.uuid;
  if (!uuid || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid)) {
    throw new BadRequestException('Invalid CDN XHTTP identity');
  }
  const profile = cfXhttpProfile(credentials);
  if (credentials.xhttpExtra || (credentials.xhttpHost && credentials.xhttpHost !== domain)) {
    throw new BadRequestException('Unsupported CDN XHTTP options; alternate download endpoints are forbidden');
  }
  if (!credentials.path || !/^\/[A-Za-z0-9_/-]{1,128}$/.test(credentials.path)) {
    throw new BadRequestException('Invalid CDN XHTTP path');
  }
  return { uuid, path: credentials.path, xhttpMode: profile.mode, xhttpHost: domain,
    ...(profile.alpn === 'h3' ? { xhttpAlpn: 'h3' } : {}) };
}
