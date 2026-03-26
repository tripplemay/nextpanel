import {
  Controller,
  Get,
  Put,
  Delete,
  UseGuards,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { WxWorkSettingsService } from './wxwork-settings.service';
import { UpsertWxWorkSettingDto } from './dto/upsert-wxwork-setting.dto';

@ApiTags('wxwork')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wxwork')
export class WxWorkController {
  constructor(private readonly settingsService: WxWorkSettingsService) {}

  @Get('settings')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get WeChat Work settings (secret masked)' })
  get() {
    return this.settingsService.get();
  }

  @Put('settings')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create or update WeChat Work settings' })
  upsert(@Body() dto: UpsertWxWorkSettingDto) {
    return this.settingsService.upsert(dto);
  }

  @Delete('settings')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete WeChat Work settings (disable login)' })
  async remove() {
    await this.settingsService.remove();
  }
}
