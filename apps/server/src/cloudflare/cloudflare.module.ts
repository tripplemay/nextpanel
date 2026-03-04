import { Module } from '@nestjs/common';
import { CloudflareService } from './cloudflare.service';
import { CloudflareSettingsService } from './cloudflare-settings.service';
import { CloudflareSettingsController } from './cloudflare-settings.controller';
import { CryptoService } from '../common/crypto/crypto.service';

@Module({
  providers: [CloudflareService, CloudflareSettingsService, CryptoService],
  controllers: [CloudflareSettingsController],
  exports: [CloudflareService, CloudflareSettingsService],
})
export class CloudflareModule {}
