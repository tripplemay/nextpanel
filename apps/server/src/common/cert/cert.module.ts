import { Module } from '@nestjs/common';
import { CertService } from './cert.service';

@Module({
  providers: [CertService],
  exports: [CertService],
})
export class CertModule {}
