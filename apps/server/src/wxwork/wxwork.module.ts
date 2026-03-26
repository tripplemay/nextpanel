import { Module } from '@nestjs/common';
import { WxWorkService } from './wxwork.service';
import { WxWorkSettingsService } from './wxwork-settings.service';
import { WxWorkController } from './wxwork.controller';
import { CryptoService } from '../common/crypto/crypto.service';

@Module({
  providers: [WxWorkService, WxWorkSettingsService, CryptoService],
  controllers: [WxWorkController],
  exports: [WxWorkService, WxWorkSettingsService],
})
export class WxWorkModule {}
