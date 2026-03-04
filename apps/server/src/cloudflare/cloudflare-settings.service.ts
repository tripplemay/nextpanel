import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CloudflareService, type CfVerifyResult } from './cloudflare.service';
import { UpsertCloudflareSettingDto } from './dto/upsert-cloudflare-setting.dto';

@Injectable()
export class CloudflareSettingsService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private cfService: CloudflareService,
  ) {}

  async upsert(userId: string, dto: UpsertCloudflareSettingDto) {
    const apiTokenEnc = await this.crypto.encrypt(dto.apiToken);
    return this.prisma.cloudflareSetting.upsert({
      where: { userId },
      create: { userId, apiTokenEnc, domain: dto.domain, zoneId: dto.zoneId },
      update: { apiTokenEnc, domain: dto.domain, zoneId: dto.zoneId },
      select: { id: true, domain: true, zoneId: true, createdAt: true, updatedAt: true },
    });
  }

  async findByUser(userId: string) {
    const setting = await this.prisma.cloudflareSetting.findUnique({
      where: { userId },
      select: { id: true, domain: true, zoneId: true, createdAt: true, updatedAt: true },
    });
    return setting ?? null;
  }

  async remove(userId: string) {
    const setting = await this.prisma.cloudflareSetting.findUnique({ where: { userId } });
    if (!setting) throw new NotFoundException('Cloudflare setting not found');
    await this.prisma.cloudflareSetting.delete({ where: { userId } });
  }

  /** Verify that the stored credentials can access Cloudflare */
  async verify(userId: string): Promise<CfVerifyResult> {
    const creds = await this.getDecryptedToken(userId);
    if (!creds) {
      return { valid: false, message: '未配置 Cloudflare 设置' };
    }
    return this.cfService.verifyZoneAccess(creds.apiToken, creds.zoneId);
  }

  /** Decrypt and return the raw API token — used internally by other services */
  async getDecryptedToken(userId: string): Promise<{ apiToken: string; domain: string; zoneId: string } | null> {
    const setting = await this.prisma.cloudflareSetting.findUnique({ where: { userId } });
    if (!setting) return null;
    const apiToken = await this.crypto.decrypt(setting.apiTokenEnc);
    return { apiToken, domain: setting.domain, zoneId: setting.zoneId };
  }
}
