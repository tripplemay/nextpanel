import { Module } from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { ReleasesController } from './releases.controller';
import { AuditModule } from '../audit/audit.module';
import { ServersModule } from '../servers/servers.module';
import { TemplatesModule } from '../templates/templates.module';

@Module({
  imports: [AuditModule, ServersModule, TemplatesModule],
  providers: [ReleasesService],
  controllers: [ReleasesController],
  exports: [ReleasesService],
})
export class ReleasesModule {}
