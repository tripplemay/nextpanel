import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { UpsertOpenRouterSettingDto } from './dto/upsert-openrouter-setting.dto';

@Injectable()
export class OpenRouterSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get() {
    const setting = await this.prisma.openRouterSetting.findFirst();
    if (!setting) return null;
    return {
      id: setting.id,
      model: setting.model,
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
    };
  }

  async getDecrypted() {
    const setting = await this.prisma.openRouterSetting.findFirst();
    if (!setting) return null;
    return {
      apiKey: this.crypto.decrypt(setting.apiKeyEnc),
      model: setting.model,
    };
  }

  async upsert(dto: UpsertOpenRouterSettingDto) {
    const apiKeyEnc = this.crypto.encrypt(dto.apiKey);
    const existing = await this.prisma.openRouterSetting.findFirst();

    if (existing) {
      return this.prisma.openRouterSetting.update({
        where: { id: existing.id },
        data: {
          apiKeyEnc,
          model: dto.model ?? existing.model,
        },
        select: { id: true, model: true, createdAt: true, updatedAt: true },
      });
    }

    return this.prisma.openRouterSetting.create({
      data: {
        apiKeyEnc,
        model: dto.model ?? 'anthropic/claude-sonnet-4',
      },
      select: { id: true, model: true, createdAt: true, updatedAt: true },
    });
  }

  async remove() {
    const existing = await this.prisma.openRouterSetting.findFirst();
    if (!existing) throw new NotFoundException('OpenRouter 未配置');
    await this.prisma.openRouterSetting.delete({ where: { id: existing.id } });
  }

  async isConfigured(): Promise<boolean> {
    const count = await this.prisma.openRouterSetting.count();
    return count > 0;
  }
}
