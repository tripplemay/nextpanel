import { Module } from '@nestjs/common';
import { InviteCodesService } from './invite-codes.service';
import { InviteCodesController } from './invite-codes.controller';

@Module({
  providers: [InviteCodesService],
  controllers: [InviteCodesController],
})
export class InviteCodesModule {}
