import { Module } from '@nestjs/common';
import { CloudflareService } from './cloudflare.service';
import { CloudflareSettingsService } from './cloudflare-settings.service';
import { CloudflareSettingsController } from './cloudflare-settings.controller';
import { CryptoService } from '../common/crypto/crypto.service';
import { CfOriginService } from './cf-origin.service';
import { ResourcesModule } from '../resources/resources.module';

@Module({
  imports: [ResourcesModule],
  providers: [CloudflareService, CloudflareSettingsService, CryptoService, CfOriginService],
  controllers: [CloudflareSettingsController],
  exports: [CloudflareService, CloudflareSettingsService, CfOriginService],
})
export class CloudflareModule {}
