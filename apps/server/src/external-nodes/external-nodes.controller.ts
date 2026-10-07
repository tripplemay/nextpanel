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
  Res,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExternalNodesService } from './external-nodes.service';
import { ImportExternalNodesDto } from './dto/import-external-nodes.dto';
import { RenameExternalNodeDto } from './dto/rename-external-node.dto';
import { ConfirmPasswordDto } from '../auth/dto/confirm-password.dto';
import { AuthService } from '../auth/auth.service';
import { Audit } from '../common/decorators/audit.decorator';

@ApiTags('external-nodes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('external-nodes')
export class ExternalNodesController {
  constructor(private readonly service: ExternalNodesService, private readonly auth: AuthService) {}

  @Post(':id/credentials')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audit('CREDENTIAL_READ', 'external-node')
  async credentials(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
    @Body() dto: ConfirmPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    try { await this.auth.verifyPassword(user.id, dto.currentPassword); }
    catch (error) {
      if (error instanceof UnauthorizedException) throw new BadRequestException('当前密码不正确');
      throw error;
    }
    return this.service.getCredentials(id, user.id);
  }

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
