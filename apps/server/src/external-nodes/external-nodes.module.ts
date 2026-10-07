import { Module } from '@nestjs/common';
import { ExternalNodesService } from './external-nodes.service';
import { ExternalNodesController } from './external-nodes.controller';
import { NodesModule } from '../nodes/nodes.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [NodesModule, AuthModule],
  providers: [ExternalNodesService],
  controllers: [ExternalNodesController],
  exports: [ExternalNodesService],
})
export class ExternalNodesModule {}
