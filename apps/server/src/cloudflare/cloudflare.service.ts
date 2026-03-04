/**
 * CloudflareService — thin wrapper around Cloudflare DNS API v4.
 * Only the operations needed by the panel (create A record, delete record).
 *
 * All methods accept explicit apiToken + zoneId so that the caller
 * controls which account credentials are used; no global state.
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';

const CF_API = 'https://api.cloudflare.com/client/v4';

export interface CfDnsRecord {
  id: string;
  name: string;
  content: string;
}

export interface CfVerifyResult {
  valid: boolean;
  zoneName?: string;
  zoneStatus?: string;
  message: string;
}

@Injectable()
export class CloudflareService {
  private readonly logger = new Logger(CloudflareService.name);

  /**
   * Create a proxied A record pointing subdomain → ip.
   * Returns the newly created DNS record ID.
   */
  async createARecord(
    apiToken: string,
    zoneId: string,
    subdomain: string,
    ip: string,
  ): Promise<string> {
    const url = `${CF_API}/zones/${zoneId}/dns_records`;
    const body = JSON.stringify({
      type: 'A',
      name: subdomain,
      content: ip,
      proxied: true,
      ttl: 1, // auto when proxied
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(apiToken),
      body,
    });

    const data = (await res.json()) as { success: boolean; errors: { message: string }[]; result: CfDnsRecord };

    if (!data.success) {
      const msg = data.errors.map((e) => e.message).join('; ');
      this.logger.error(`Cloudflare createARecord failed: ${msg}`);
      throw new BadRequestException(`Cloudflare API error: ${msg}`);
    }

    this.logger.log(`Created DNS A record ${subdomain} → ${ip} (id=${data.result.id})`);
    return data.result.id;
  }

  /**
   * Delete a DNS record by its Cloudflare record ID.
   * Does NOT throw if the record is already gone (idempotent).
   */
  async deleteRecord(apiToken: string, zoneId: string, recordId: string): Promise<void> {
    const url = `${CF_API}/zones/${zoneId}/dns_records/${recordId}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers(apiToken),
    });

    if (res.status === 404) {
      this.logger.warn(`Cloudflare record ${recordId} already deleted (404).`);
      return;
    }

    const data = (await res.json()) as { success: boolean; errors: { message: string }[] };

    if (!data.success) {
      const msg = data.errors.map((e) => e.message).join('; ');
      this.logger.error(`Cloudflare deleteRecord failed: ${msg}`);
      throw new BadRequestException(`Cloudflare API error: ${msg}`);
    }

    this.logger.log(`Deleted DNS record ${recordId}`);
  }

  /**
   * Verify that apiToken can access the given zoneId.
   * Returns zone name and status on success, or an error message on failure.
   */
  async verifyZoneAccess(apiToken: string, zoneId: string): Promise<CfVerifyResult> {
    const url = `${CF_API}/zones/${zoneId}`;
    try {
      const res = await fetch(url, { headers: this.headers(apiToken) });
      const data = (await res.json()) as {
        success: boolean;
        errors: { message: string; code: number }[];
        result?: { name: string; status: string };
      };

      if (!data.success) {
        const msg = data.errors.map((e) => e.message).join('; ');
        return { valid: false, message: `验证失败：${msg}` };
      }

      return {
        valid: true,
        zoneName: data.result?.name,
        zoneStatus: data.result?.status,
        message: `验证成功：${data.result?.name ?? zoneId}（${data.result?.status ?? 'unknown'}）`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, message: `请求失败：${msg}` };
    }
  }

  private headers(apiToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };
  }
}
