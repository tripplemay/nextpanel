import { Module } from '@nestjs/common';
import { ServersService } from './servers.service';
import { ServersController } from './servers.controller';
import { CryptoService } from '../common/crypto/crypto.service';

@Module({
  providers: [ServersService, CryptoService],
  controllers: [ServersController],
  exports: [ServersService],
})
export class ServersModule {}
