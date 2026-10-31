import { Module } from '@nestjs/common';
import { CryptoService } from '../common/crypto/crypto.service';
import { ResourceLifecycleService } from './resource-lifecycle.service';
import { ResourcesController } from './resources.controller';
import { ResourceInventoryScheduler } from './resource-inventory.scheduler';

@Module({
  providers: [CryptoService, ResourceLifecycleService, ResourceInventoryScheduler],
  controllers: [ResourcesController],
  exports: [ResourceLifecycleService],
})
export class ResourcesModule {}
