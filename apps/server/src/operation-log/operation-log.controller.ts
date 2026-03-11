import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { OperationLogService } from './operation-log.service';

@ApiTags('operation-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('operation-logs')
export class OperationLogController {
  constructor(private operationLogService: OperationLogService) {}

  @Get('by-correlation/:correlationId')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  @ApiOperation({ summary: 'Get operation log linked to an audit log via correlationId' })
  getByCorrelationId(@Param('correlationId') correlationId: string) {
    return this.operationLogService.getByCorrelationId(correlationId);
  }

  @Get('by-resource/:type/:id')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  @ApiOperation({ summary: 'List recent operation logs for a resource' })
  listByResource(
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.operationLogService.listByResource(type, id);
  }

  @Get(':id')
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  @ApiOperation({ summary: 'Get full log text for a specific operation log entry' })
  getLog(@Param('id') id: string) {
    return this.operationLogService.getLog(id);
  }
}
