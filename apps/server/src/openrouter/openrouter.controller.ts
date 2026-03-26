import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  UseGuards,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { OpenRouterSettingsService } from './openrouter-settings.service';
import { OpenRouterService } from './openrouter.service';
import { UpsertOpenRouterSettingDto } from './dto/upsert-openrouter-setting.dto';

@ApiTags('openrouter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('openrouter')
export class OpenRouterController {
  constructor(
    private readonly settingsService: OpenRouterSettingsService,
    private readonly openRouterService: OpenRouterService,
  ) {}

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

  @Get('models')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List available models from OpenRouter' })
  listModels() {
    return this.openRouterService.listModels();
  }

  @Post('test')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Test API key and model availability' })
  test(@Body('model') model?: string) {
    return this.openRouterService.testConnection(model);
  }
}
