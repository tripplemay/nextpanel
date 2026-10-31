import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ResourcesModule } from '../resources/resources.module';
import { CryptoService } from '../common/crypto/crypto.service';
import { UsageService } from './usage.service';
import { UsageProvisioner } from './usage-provisioner.service';
import { UsageController } from './usage.controller';

@Module({ imports: [AuthModule, ResourcesModule], providers: [CryptoService, UsageService, UsageProvisioner],
  controllers: [UsageController], exports: [UsageService] })
export class UsageModule {}
