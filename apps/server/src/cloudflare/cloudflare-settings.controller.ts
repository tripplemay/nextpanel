import { Controller, Get, Put, Delete, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CloudflareSettingsService } from './cloudflare-settings.service';
import { UpsertCloudflareSettingDto } from './dto/upsert-cloudflare-setting.dto';

@ApiTags('cloudflare')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cloudflare/settings')
export class CloudflareSettingsController {
  constructor(private settingsService: CloudflareSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user Cloudflare settings (token omitted)' })
  findMine(@CurrentUser() user: { id: string }) {
    return this.settingsService.findByUser(user.id);
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verify stored Cloudflare credentials against the API' })
  verify(@CurrentUser() user: { id: string }) {
    return this.settingsService.verify(user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Create or update Cloudflare settings for current user' })
  upsert(@CurrentUser() user: { id: string }, @Body() dto: UpsertCloudflareSettingDto) {
    return this.settingsService.upsert(user.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove Cloudflare settings for current user' })
  remove(@CurrentUser() user: { id: string }) {
    return this.settingsService.remove(user.id);
  }
}
