import { BadRequestException, Body, Controller, Get, Post, Patch, Delete, Query, UseGuards, Req, Res, Header } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmPasswordDto } from './dto/confirm-password.dto';
import { Audit } from '../common/decorators/audit.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WxWorkService } from '../wxwork/wxwork.service';
import { OAuthStateService } from './oauth-state.service';
import { OAuthCallbackDto, OAuthBindStartDto } from './dto/oauth-callback.dto';

@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private authService: AuthService,
    private wxWorkService: WxWorkService,
    private oauthState: OAuthStateService,
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
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audit('UPDATE', 'account-password')
  changePassword(
    @CurrentUser() user: { id: string; tokenVersion: number },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.id, dto, user.tokenVersion);
  }

  @Post('revoke-other-sessions')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audit('LOGOUT', 'other-sessions')
  revokeOtherSessions(@CurrentUser() user: { id: string; tokenVersion: number }, @Body() dto: ConfirmPasswordDto) {
    return this.authService.revokeOtherSessions(user.id, dto.currentPassword, user.tokenVersion);
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
    @Res({ passthrough: true }) res: Response,
  ) {
    const d = device === 'mobile' ? 'mobile' : 'desktop';
    const callbackUri = this.oauthState.callbackUri('login');
    if (redirectUri && redirectUri !== callbackUri) throw new BadRequestException('不允许该回调地址');
    const state = await this.oauthState.issue('login', res);
    const url = await this.wxWorkService.getLoginUrl(callbackUri, state, d);
    return { url, state };
  }

  @Post('wxwork/bind-url')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async wxWorkBindUrl(
    @CurrentUser() user: { id: string },
    @Body() dto: OAuthBindStartDto,
    @Query('device') device: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.verifyPassword(user.id, dto.currentPassword);
    const state = await this.oauthState.issue('bind', res, user.id);
    const url = await this.wxWorkService.getLoginUrl(
      this.oauthState.callbackUri('bind'), state, device === 'mobile' ? 'mobile' : 'desktop',
    );
    return { url, state };
  }

  @Post('wxwork/callback')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'WeChat Work OAuth callback — exchange code for JWT' })
  async wxWorkCallback(@Body() dto: OAuthCallbackDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.oauthState.consume('login', dto.state, req, res);
    const { userId, name } = await this.wxWorkService.getUserByCode(dto.code);
    return this.authService.wxWorkLogin(userId, name);
  }

  @Post('wxwork/bind')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Bind WeChat Work account to current user' })
  async wxWorkBind(
    @CurrentUser() user: { id: string },
    @Body() dto: OAuthCallbackDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.oauthState.consume('bind', dto.state, req, res, user.id);
    const { userId, name } = await this.wxWorkService.getUserByCode(dto.code);
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
