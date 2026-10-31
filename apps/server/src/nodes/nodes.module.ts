import { Module } from '@nestjs/common';
import { NodesService } from './nodes.service';
import { NodeDeployService } from './node-deploy.service';
import { NodesController } from './nodes.controller';
import { CryptoService } from '../common/crypto/crypto.service';
import { XrayTestService } from './xray-test/xray-test.service';
import { SingboxTestService } from './singbox-test/singbox-test.service';
import { ConnectivityScheduler } from './connectivity.scheduler';
import { CertRenewalScheduler } from './cert-renewal.scheduler';
import { AuditModule } from '../audit/audit.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { CloudflareModule } from '../cloudflare/cloudflare.module';
import { CertModule } from '../common/cert/cert.module';
import { SocksExitResolverService } from './socks-exit-resolver.service';
import { ResourcesModule } from '../resources/resources.module';
import { ResourceCleanupScheduler } from './resource-cleanup.scheduler';

@Module({
  imports: [AuditModule, OperationLogModule, CloudflareModule, CertModule, ResourcesModule],
  providers: [NodesService, NodeDeployService, CryptoService, XrayTestService, SingboxTestService, SocksExitResolverService, ConnectivityScheduler, CertRenewalScheduler, ResourceCleanupScheduler],
  controllers: [NodesController],
  exports: [NodesService, NodeDeployService, XrayTestService, SingboxTestService, SocksExitResolverService],
})
export class NodesModule {}
