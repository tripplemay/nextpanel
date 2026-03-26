import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { UpsertWxWorkSettingDto } from './dto/upsert-wxwork-setting.dto';

@Injectable()
export class WxWorkSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get() {
    const setting = await this.prisma.wxWorkSetting.findFirst();
    if (!setting) return null;
    return {
      id: setting.id,
      corpId: setting.corpId,
      agentId: setting.agentId,
      proxyUrl: setting.proxyUrl,
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };
  }

  async getDecrypted() {
    const setting = await this.prisma.wxWorkSetting.findFirst();
    if (!setting) return null;
    return {
      corpId: setting.corpId,
      agentId: setting.agentId,
      secret: this.crypto.decrypt(setting.secretEnc),
      proxyUrl: setting.proxyUrl,
    };
  }

  async upsert(dto: UpsertWxWorkSettingDto) {
    const secretEnc = this.crypto.encrypt(dto.secret);
    const existing = await this.prisma.wxWorkSetting.findFirst();

    if (existing) {
      return this.prisma.wxWorkSetting.update({
        where: { id: existing.id },
        data: {
          corpId: dto.corpId,
          agentId: dto.agentId,
          secretEnc,
          proxyUrl: dto.proxyUrl ?? null,
        },
        select: { id: true, corpId: true, agentId: true, proxyUrl: true, createdAt: true, updatedAt: true },
      });
    }

    return this.prisma.wxWorkSetting.create({
      data: {
        corpId: dto.corpId,
        agentId: dto.agentId,
        secretEnc,
        proxyUrl: dto.proxyUrl ?? null,
      },
      select: { id: true, corpId: true, agentId: true, proxyUrl: true, createdAt: true, updatedAt: true },
    });
  }

  async remove() {
    const existing = await this.prisma.wxWorkSetting.findFirst();
    if (!existing) throw new NotFoundException('企业微信未配置');
    await this.prisma.wxWorkSetting.delete({ where: { id: existing.id } });
  }

  async isConfigured(): Promise<boolean> {
    const count = await this.prisma.wxWorkSetting.count();
    return count > 0;
  }
}
