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
import { OpenRouterSettingsService } from './openrouter-settings.service';
import { UpsertOpenRouterSettingDto } from './dto/upsert-openrouter-setting.dto';

@ApiTags('openrouter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('openrouter')
export class OpenRouterController {
  constructor(private readonly settingsService: OpenRouterSettingsService) {}

  @Get('settings')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get OpenRouter settings (API key masked)' })
  get() {
    return this.settingsService.get();
  }

  @Put('settings')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create or update OpenRouter settings' })
  upsert(@Body() dto: UpsertOpenRouterSettingDto) {
    return this.settingsService.upsert(dto);
  }

  @Delete('settings')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete OpenRouter settings' })
  async remove() {
    await this.settingsService.remove();
  }
}
