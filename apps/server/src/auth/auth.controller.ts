import { Body, Controller, Get, Post, Patch, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WxWorkService } from '../wxwork/wxwork.service';

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private authService: AuthService,
    private wxWorkService: WxWorkService,
    private config: ConfigService,
  ) {}

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: { jti?: string; tokenExp?: number }) {
    if (user.jti && user.tokenExp) {
      await this.authService.logout(user.jti, new Date(user.tokenExp * 1000));
    }
    return { message: 'Logged out' };
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: { id: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto);
  }

  // ─── WeChat Work OAuth ────────────────────────────────────────────────────

  @Get('wxwork/configured')
  @ApiOperation({ summary: 'Check if WeChat Work login is configured' })
  async wxWorkConfigured() {
    const configured = await this.wxWorkService.isConfigured();
    return { configured };
  }

  @Get('wxwork/login-url')
  @ApiOperation({ summary: 'Get WeChat Work OAuth login URL' })
  async wxWorkLoginUrl(
    @Query('device') device: string,
    @Query('redirect_uri') redirectUri: string,
  ) {
    const d = device === 'mobile' ? 'mobile' : 'desktop';
    const panelUrl = this.config.get<string>('PANEL_URL') ?? '';
    const callbackUri = redirectUri || `${panelUrl}/wxwork/callback`;
    const state = Math.random().toString(36).slice(2);
    const url = await this.wxWorkService.getLoginUrl(callbackUri, state, d);
    return { url, state };
  }

  @Post('wxwork/callback')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'WeChat Work OAuth callback — exchange code for JWT' })
  async wxWorkCallback(@Body('code') code: string) {
    if (!code) throw new Error('code is required');
    const { userId, name } = await this.wxWorkService.getUserByCode(code);
    return this.authService.wxWorkLogin(userId, name);
  }

  @Post('wxwork/bind')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Bind WeChat Work account to current user' })
  async wxWorkBind(
    @CurrentUser() user: { id: string },
    @Body('code') code: string,
  ) {
    if (!code) throw new Error('code is required');
    const { userId, name } = await this.wxWorkService.getUserByCode(code);
    await this.authService.wxWorkBind(user.id, userId, name);
    return { bound: true, wxWorkName: name };
  }

  @Delete('wxwork/unbind')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Unbind WeChat Work account from current user' })
  async wxWorkUnbind(@CurrentUser() user: { id: string }) {
    await this.authService.wxWorkUnbind(user.id);
    return { bound: false };
  }

  @Get('wxwork/bind-status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get WeChat Work bind status for current user' })
  wxWorkBindStatus(@CurrentUser() user: { id: string }) {
    return this.authService.getWxWorkBindStatus(user.id);
  }
}
