import { Module } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';
import { PipelinesController } from './pipelines.controller';
import { CryptoService } from '../common/crypto/crypto.service';

@Module({
  providers: [PipelinesService, CryptoService],
  controllers: [PipelinesController],
})
export class PipelinesModule {}
