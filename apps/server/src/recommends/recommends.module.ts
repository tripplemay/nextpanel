import { Module } from '@nestjs/common';
import { RecommendsService } from './recommends.service';
import { RecommendsController } from './recommends.controller';
import { OpenRouterModule } from '../openrouter/openrouter.module';

@Module({
  imports: [OpenRouterModule],
  providers: [RecommendsService],
  controllers: [RecommendsController],
})
export class RecommendsModule {}
