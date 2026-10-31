import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { NodesModule } from '../nodes/nodes.module';
import { AuthModule } from '../auth/auth.module';
import { CfAccessService } from './cf-access.service';
import { CfOptimizationService } from './cf-optimization.service';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [NodesModule, AuthModule, UsageModule],
  providers: [SubscriptionsService, CfAccessService, CfOptimizationService],
  controllers: [SubscriptionsController],
})
export class SubscriptionsModule {}
