import { BadRequestException } from '@nestjs/common';

export type ClientProfile = 'compatible' | 'xhttp';

const minimumXhttpVersions: Record<string, readonly number[]> = {
  shadowrocket: [2, 2, 67],
  mihomo: [1, 19, 22],
  'clash.meta': [1, 19, 22],
  xray: [24, 11, 30],
  v2rayn: [7, 3, 0],
  v2rayng: [1, 9, 24],
};

function supportsXhttp(userAgent: unknown): boolean {
  if (typeof userAgent !== 'string' || userAgent.length > 512) return false;
  const product = userAgent.trim().split(/[\s(]/, 1)[0].toLowerCase();
  // Opaque build IDs are not semantic versions. Keep this rollout's numeric
  // Shadowrocket build as a conservative floor, not a claimed first XHTTP release.
  const shadowrocketBuild = /^shadowrocket\/(\d{4,6})$/.exec(product);
  if (shadowrocketBuild) return Number(shadowrocketBuild[1]) >= 3488;
  // This deployed alpha was reviewed at its exact upstream source revision.
  if (product === 'clash.meta/alpha-gbc76c13' || product === 'mihomo/alpha-gbc76c13') return true;
  const match = /^(Shadowrocket|mihomo|Clash\.Meta|Xray|v2rayN|v2rayNG)\/v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?=$|[\s(])/i.exec(userAgent.trim());
  if (!match) return false;
  const version = match.slice(2).map(Number), minimum = minimumXhttpVersions[match[1].toLowerCase()];
  for (let i = 0; i < minimum.length; i++) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i];
  }
  return true;
}

// UA is a format hint, never authorization. Explicit profiles override it;
// unknown/old clients stay compatible and all paths retain the same CDN checks.
export function clientProfile(value: unknown, userAgent?: unknown): ClientProfile {
  if (value === undefined || value === 'auto') return supportsXhttp(userAgent) ? 'xhttp' : 'compatible';
  if (value === 'compatible') return 'compatible';
  if (value === 'xhttp') return 'xhttp';
  throw new BadRequestException('Invalid client profile; expected auto, compatible or xhttp');
}
