import { Module } from '@nestjs/common';
import { OpenRouterService } from './openrouter.service';
import { OpenRouterSettingsService } from './openrouter-settings.service';
import { OpenRouterController } from './openrouter.controller';
import { CryptoService } from '../common/crypto/crypto.service';

@Module({
  providers: [OpenRouterService, OpenRouterSettingsService, CryptoService],
  controllers: [OpenRouterController],
  exports: [OpenRouterService, OpenRouterSettingsService],
})
export class OpenRouterModule {}
