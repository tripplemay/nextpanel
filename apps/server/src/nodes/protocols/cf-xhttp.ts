import { BadRequestException } from '@nestjs/common';

export const CF_XHTTP_MODE = 'packet-up';
export const CF_XHTTP_XRAY_VERSION = '26.2.6';

export function isCfXhttp(node: { protocol: string; transport?: string | null; tls?: string | null }): boolean {
  return node.protocol === 'VLESS' && node.transport === 'XHTTP' && node.tls === 'TLS';
}

export function assertCfXhttpPilotEnabled(): void {
  if (process.env.CF_XHTTP_PILOT_ENABLED !== 'true') {
    throw new BadRequestException('XHTTP CDN pilot is disabled; existing WS nodes are unchanged');
  }
}

// Keep the CDN pilot deliberately smaller than the imported XHTTP feature set.
export function cfXhttpCredentials(credentials: Record<string, string | undefined>, domain: string): Record<string, string> {
  const uuid = credentials.uuid;
  if (!uuid || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uuid)) {
    throw new BadRequestException('Invalid CDN XHTTP identity');
  }
  if (credentials.xhttpExtra || (credentials.xhttpMode && credentials.xhttpMode !== CF_XHTTP_MODE)
    || (credentials.xhttpHost && credentials.xhttpHost !== domain)) {
    throw new BadRequestException('Unsupported CDN XHTTP options; alternate download endpoints are forbidden');
  }
  if (!credentials.path || !/^\/[A-Za-z0-9_/-]{1,128}$/.test(credentials.path)) {
    throw new BadRequestException('Invalid CDN XHTTP path');
  }
  return { uuid, path: credentials.path, xhttpMode: CF_XHTTP_MODE, xhttpHost: domain };
}
