import { Module } from '@nestjs/common';
import { NodesService } from './nodes.service';
import { NodeDeployService } from './node-deploy.service';
import { NodesController } from './nodes.controller';
import { CryptoService } from '../common/crypto/crypto.service';
import { XrayTestService } from './xray-test/xray-test.service';
import { SingboxTestService } from './singbox-test/singbox-test.service';
import { AuditModule } from '../audit/audit.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { CloudflareModule } from '../cloudflare/cloudflare.module';

@Module({
  imports: [AuditModule, OperationLogModule, CloudflareModule],
  providers: [NodesService, NodeDeployService, CryptoService, XrayTestService, SingboxTestService],
  controllers: [NodesController],
  exports: [NodesService, NodeDeployService],
})
export class NodesModule {}
