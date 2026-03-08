import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { IpCheckController } from './ip-check.controller';
import { IpCheckService } from './ip-check.service';
import { IpInfoService } from './ip-info.service';
import { GfwCheckService } from './gfw-check.service';
import { RouteCheckService } from './route-check/route-check.service';

@Module({
  imports: [PrismaModule],
  controllers: [IpCheckController],
  providers: [IpCheckService, IpInfoService, GfwCheckService, RouteCheckService],
  exports: [IpCheckService],
})
export class IpCheckModule {}
