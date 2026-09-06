import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExternalNodesService } from './external-nodes.service';
import { ImportExternalNodesDto } from './dto/import-external-nodes.dto';
import { RenameExternalNodeDto } from './dto/rename-external-node.dto';

@ApiTags('external-nodes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('external-nodes')
export class ExternalNodesController {
  constructor(private readonly service: ExternalNodesService) {}

  @Get()
  @ApiOperation({ summary: 'List all external nodes for current user' })
  list(@CurrentUser() user: { id: string }) {
    return this.service.list(user.id);
  }

  @Post('import')
  @ApiOperation({ summary: 'Import nodes from URI(s) or Base64 subscription content' })
  import(
    @Body() dto: ImportExternalNodesDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.import(user.id, dto.text, dto.protocol);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test connectivity for an external node' })
  test(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.test(id, user.id);
  }

  @Patch(':id/rename')
  @ApiOperation({ summary: 'Rename an external node (no connectivity change)' })
  rename(
    @Param('id') id: string,
    @Body() dto: RenameExternalNodeDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.service.rename(id, dto.name, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an external node' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    await this.service.remove(id, user.id);
  }
}
