import { Injectable, Logger } from '@nestjs/common';

export interface GfwCheckResult {
  reachable: boolean;
  latency?: number;
}

@Injectable()
export class GfwCheckService {
  private readonly logger = new Logger(GfwCheckService.name);

  get isConfigured(): boolean {
    return !!process.env.GFW_CHECK_FUNCTION_URL;
  }

  async check(ip: string, port = 443): Promise<GfwCheckResult | null> {
    const url = process.env.GFW_CHECK_FUNCTION_URL;
    if (!url) {
      this.logger.warn('GFW_CHECK_FUNCTION_URL not configured, skipping GFW check');
      return null;
    }

    const token = process.env.GFW_CHECK_FUNCTION_TOKEN;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ip, port }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        this.logger.warn(`GFW check function returned ${res.status} for ${ip}`);
        return null;
      }

      const data = (await res.json()) as GfwCheckResult;
      return data;
    } catch (err) {
      this.logger.warn(`GFW check failed for ${ip}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
