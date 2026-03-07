import { Module } from '@nestjs/common';
import { ExternalNodesService } from './external-nodes.service';
import { ExternalNodesController } from './external-nodes.controller';
import { NodesModule } from '../nodes/nodes.module';

@Module({
  imports: [NodesModule],
  providers: [ExternalNodesService],
  controllers: [ExternalNodesController],
  exports: [ExternalNodesService],
})
export class ExternalNodesModule {}
