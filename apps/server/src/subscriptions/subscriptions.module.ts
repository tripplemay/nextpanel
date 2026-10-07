import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { NodesModule } from '../nodes/nodes.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [NodesModule, AuthModule],
  providers: [SubscriptionsService],
  controllers: [SubscriptionsController],
})
export class SubscriptionsModule {}
