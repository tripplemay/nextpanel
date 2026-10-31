import { BadRequestException } from '@nestjs/common';
import { BlockList, isIP } from 'net';
import { isFQDN } from 'class-validator';
import type { NodeExportInfo } from './uri-builder';

// Reviewed 2026-10-31: https://www.cloudflare.com/ips-v4 and /ips-v6.
// Never replace this allowlist with a user-supplied range or third-party feed.
export const CF_IP_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];
const ranges = new BlockList();
for (const cidr of CF_IP_RANGES) {
  const [address, prefix] = cidr.split('/');
  ranges.addSubnet(address, Number(prefix), isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

export function isCloudflareIp(value: string): boolean {
  const family = isIP(value);
  if (family === 0 || value.includes('%')) return false;
  if (family === 6 && new URL(`http://[${value}]`).hostname.startsWith('[::ffff:')) return false;
  return ranges.check(value, family === 6 ? 'ipv6' : 'ipv4');
}

export function normalizeCfPreferredIps(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 3) {
    throw new BadRequestException('CF preferred IPs must be an array of at most 3 addresses');
  }
  const normalized = value.map((ip: unknown) => {
    if (typeof ip !== 'string' || !isCloudflareIp(ip)) {
      throw new BadRequestException('Only literal Cloudflare IPv4/IPv6 addresses are allowed');
    }
    return isIP(ip) === 6 ? new URL(`http://[${ip}]`).hostname.slice(1, -1) : ip;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new BadRequestException('Duplicate CF preferred IPs are not allowed');
  }
  return normalized;
}

type CfManagedNode = {
  protocol: string; transport: string | null; tls: string; domain: string | null;
  listenPort: number; cfDnsRecordId?: string | null;
};

export function isCfManagedNode(node: CfManagedNode): boolean {
  return node.protocol === 'VLESS' && node.transport === 'WS' && node.tls === 'TLS'
    && node.listenPort === 443 && !!node.cfDnsRecordId && !!node.domain
    && node.domain.length <= 253 && isFQDN(node.domain);
}

export function assertCfManagedNode(node: CfManagedNode): void {
  if (!isCfManagedNode(node)) {
    throw new BadRequestException('CF-only requires managed VLESS+WS+TLS nodes on port 443 with a Cloudflare domain');
  }
}

export function cfVariants(node: NodeExportInfo, nodeId: string, preferredIps: string[], defaultIp: string | null): NodeExportInfo[] {
  const group = `${node.name} [CF ${nodeId}]`;
  const endpoints = preferredIps.map((host, i) => ({ host, label: `P${i + 1}` }));
  if (defaultIp && !preferredIps.includes(defaultIp)) endpoints.push({ host: defaultIp, label: 'DNS' });
  return endpoints.map(({ host, label }) => ({
    ...node,
    host,
    name: `${group} ${label}`,
    cfGroup: group,
    credentials: { ...node.credentials, transportHost: node.domain! },
  }));
}
