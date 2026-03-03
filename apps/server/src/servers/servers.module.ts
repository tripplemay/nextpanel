import { Module } from '@nestjs/common';
import { ServersService } from './servers.service';
import { ServersController } from './servers.controller';
import { AutoSetupService } from './auto-setup.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { PingScheduler } from './ping.scheduler';
import { NodesModule } from '../nodes/nodes.module';
import { OperationLogModule } from '../operation-log/operation-log.module';

@Module({
  imports: [NodesModule, OperationLogModule],
  providers: [ServersService, CryptoService, PingScheduler, AutoSetupService],
  controllers: [ServersController],
  exports: [ServersService],
})
export class ServersModule {}
