import { Injectable, Logger } from '@nestjs/common';

interface IpApiResponse {
  status: string;
  country: string;
  countryCode: string;
  city: string;
  as: string;
  hosting: boolean;
}

interface IpInfoResponse {
  org?: string;
}

export interface IpInfo {
  ipType: 'RESIDENTIAL' | 'DATACENTER';
  asn: string;
  org: string;
  country: string;
  city: string;
}

@Injectable()
export class IpInfoService {
  private readonly logger = new Logger(IpInfoService.name);

  async lookup(ip: string): Promise<IpInfo | null> {
    try {
      const [ipApi, ipInfo] = await Promise.all([
        this.fetchIpApi(ip),
        this.fetchIpInfo(ip),
      ]);

      if (!ipApi) return null;

      // Parse ASN from ip-api "as" field, e.g. "AS45102 Alibaba (US) Technology Co., Ltd."
      const asnMatch = ipApi.as.match(/^(AS\d+)/);
      const asn = asnMatch ? asnMatch[1] : ipApi.as;

      // Prefer ipinfo.io org (cleaner name), fall back to ip-api "as" field
      const org = ipInfo?.org
        ? ipInfo.org.replace(/^AS\d+\s+/, '')
        : ipApi.as.replace(/^AS\d+\s+/, '');

      return {
        ipType: ipApi.hosting ? 'DATACENTER' : 'RESIDENTIAL',
        asn,
        org,
        country: ipApi.countryCode,
        city: ipApi.city,
      };
    } catch (err) {
      this.logger.warn(`IP lookup failed for ${ip}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async fetchIpApi(ip: string): Promise<IpApiResponse | null> {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,as,hosting`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as IpApiResponse;
    if (data.status !== 'success') return null;
    return data;
  }

  private async fetchIpInfo(ip: string): Promise<IpInfoResponse | null> {
    try {
      const res = await fetch(`https://ipinfo.io/${ip}/json`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      return (await res.json()) as IpInfoResponse;
    } catch {
      return null;
    }
  }
}
