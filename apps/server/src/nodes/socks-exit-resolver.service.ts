import { Injectable } from '@nestjs/common';
import { isIP } from 'net';
import type { Socks5ExitConfig } from './socks-uri';

const DOH_TIMEOUT_MS = 5000;
const MAX_CANDIDATES = 12;

interface DohProfile {
  label: string;
  clientSubnet?: string;
}

const DOH_PROFILES: DohProfile[] = [
  { label: 'Google DoH' },
  { label: 'Google DoH / CN ECS 223.5.5.5/24', clientSubnet: '223.5.5.5/24' },
  { label: 'Google DoH / CN ECS 114.114.114.114/24', clientSubnet: '114.114.114.114/24' },
];

export interface SocksExitCandidate {
  address: string;
  sources: string[];
}

export interface SocksExitResolution {
  candidates: SocksExitCandidate[];
  warnings: string[];
}

interface DohAnswer {
  type?: number;
  data?: string;
}

interface DohResponse {
  Status?: number;
  Answer?: DohAnswer[];
}

@Injectable()
export class SocksExitResolverService {
  async resolve(host: string, entrySystemAddresses: string[]): Promise<SocksExitResolution> {
    if (isIP(host)) {
      return {
        candidates: [{ address: host, sources: ['SOCKS URI'] }],
        warnings: [],
      };
    }

    const candidates = new Map<string, Set<string>>();
    const warnings: string[] = [];
    const add = (address: string, source: string) => {
      if (!isIP(address)) return;
      const sources = candidates.get(address) ?? new Set<string>();
      sources.add(source);
      candidates.set(address, sources);
    };

    for (const address of entrySystemAddresses) add(address, '入口系统 DNS');

    const queries = DOH_PROFILES.flatMap((profile) => [1, 28].map(async (type) => {
      const query = new URLSearchParams({
        name: host,
        type: type === 1 ? 'A' : 'AAAA',
        ...(profile.clientSubnet ? { edns_client_subnet: profile.clientSubnet } : {}),
      });
      try {
        const response = await fetch(`https://dns.google/resolve?${query.toString()}`, {
          headers: { accept: 'application/dns-json' },
          signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = await response.json() as DohResponse;
        if (body.Status !== 0) {
          throw new Error(`DNS status ${String(body.Status)}`);
        }
        return {
          source: profile.label,
          addresses: (body.Answer ?? [])
            .filter((answer) =>
              (answer.type === 1 || answer.type === 28) && typeof answer.data === 'string')
            .map((answer) => answer.data!),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          source: profile.label,
          addresses: [] as string[],
          warning: `${profile.label} ${type === 1 ? 'A' : 'AAAA'}: ${message}`,
        };
      }
    }));

    const queryResults = await Promise.all(queries);
    for (const result of queryResults) {
      if (result.warning) warnings.push(result.warning);
      for (const address of result.addresses) add(address, result.source);
    }

    const orderedCandidates = Array.from(candidates, ([address, sources]) => ({
      address,
      sources: Array.from(sources),
    })).sort((left, right) => isIP(left.address) - isIP(right.address));

    return {
      candidates: orderedCandidates.slice(0, MAX_CANDIDATES),
      warnings,
    };
  }
}

export function buildSocksExitProbeConfig(
  implementation: string,
  socks: Socks5ExitConfig,
  address: string,
  localPort: number,
): string {
  const credentials = socks.username !== undefined
    ? { username: socks.username, password: socks.password ?? '' }
    : {};

  if (implementation === 'SING_BOX') {
    return JSON.stringify({
      log: { level: 'info' },
      inbounds: [{
        type: 'socks',
        tag: 'probe-in',
        listen: '127.0.0.1',
        listen_port: localPort,
      }],
      outbounds: [{
        type: 'socks',
        tag: 'chain-exit',
        server: address,
        server_port: socks.port,
        version: '5',
        ...credentials,
      }],
      route: {
        rules: [{ inbound: ['probe-in'], action: 'route', outbound: 'chain-exit' }],
        final: 'chain-exit',
      },
    });
  }

  return JSON.stringify({
    log: { loglevel: 'info' },
    inbounds: [{
      listen: '127.0.0.1',
      port: localPort,
      protocol: 'socks',
      settings: { auth: 'noauth', udp: true },
      tag: 'probe-in',
    }],
    outbounds: [{
      protocol: 'socks',
      tag: 'chain-exit',
      settings: {
        address,
        port: socks.port,
        ...(socks.username !== undefined
          ? { user: socks.username, pass: socks.password ?? '' }
          : {}),
      },
      targetStrategy: 'AsIs',
    }],
    routing: {
      domainStrategy: 'AsIs',
      rules: [{ type: 'field', inboundTag: ['probe-in'], outboundTag: 'chain-exit' }],
    },
  });
}
