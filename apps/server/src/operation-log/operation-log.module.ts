import { Module } from '@nestjs/common';
import { OperationLogService } from './operation-log.service';
import { OperationLogController } from './operation-log.controller';

@Module({
  providers: [OperationLogService],
  controllers: [OperationLogController],
  exports: [OperationLogService],
})
export class OperationLogModule {}
