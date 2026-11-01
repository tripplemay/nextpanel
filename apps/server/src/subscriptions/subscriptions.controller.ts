import {
  Controller,
  Get,
  Headers,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { CfAccessService } from './cf-access.service';
import { CheckCfAccessDto } from './dto/check-cf-access.dto';
import { CfOptimizationService } from './cf-optimization.service';
import { UsageEnabledDto } from '../usage/usage.dto';
import { Audit } from '../common/decorators/audit.decorator';
import { clientProfile } from './client-profile';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService, private cfAccess: CfAccessService, private cfOptimizer: CfOptimizationService) {}

  @Post(':id/usage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'subscription-usage')
  usage(@Param('id') id: string, @Body() dto: UsageEnabledDto, @CurrentUser() user: { id: string }) {
    return this.subscriptionsService.setUsage(id, user.id, dto.enabled);
  }

  @Get('cf-access/optimization/:nodeId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  optimizationStatus(@Param('nodeId') nodeId: string, @CurrentUser() user: { id: string }) {
    return this.cfOptimizer.status(nodeId, user.id);
  }

  @Post('cf-access/optimization/:nodeId/rollback')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  rollbackOptimization(@Param('nodeId') nodeId: string, @CurrentUser() user: { id: string }) {
    return this.cfOptimizer.rollback(nodeId, user.id);
  }

  @Post('cf-access/optimization/:nodeId/resume')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  resumeOptimization(@Param('nodeId') nodeId: string, @CurrentUser() user: { id: string }) {
    return this.cfOptimizer.resume(nodeId, user.id);
  }

  @Get('link/:token/cf-provider/:nodeId')
  async cfProvider(@Param('token') token: string, @Param('nodeId') nodeId: string, @Res() res: Response, @Query('profile') profile?: string,
    @Headers('user-agent') userAgent?: string) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('User-Agent');
    res.type('text/plain').send(await this.subscriptionsService.generateCfProvider({ token }, nodeId, clientProfile(profile, userAgent)));
  }

  @Get('share/:shareToken/cf-provider/:nodeId')
  async sharedCfProvider(@Param('shareToken') shareToken: string, @Param('nodeId') nodeId: string, @Res() res: Response, @Query('profile') profile?: string,
    @Headers('user-agent') userAgent?: string) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('User-Agent');
    res.type('text/plain').send(await this.subscriptionsService.generateCfProvider({ shareToken }, nodeId, clientProfile(profile, userAgent)));
  }

  @Post('cf-access/check')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  checkCfAccess(@Body() dto: CheckCfAccessDto, @CurrentUser() user: { id: string }) {
    return this.cfAccess.check(dto.nodeId, user.id, dto.ip);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  @ApiOperation({ summary: 'Create a subscription link' })
  create(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.subscriptionsService.create(dto.name, dto.nodeIds, user.id, dto.externalNodeIds, dto);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List subscriptions — non-VIEWERs get flat array; VIEWERs get { mine, shared }' })
  async findAll(@CurrentUser() user: { id: string; role: string }) {
    if (user.role === 'VIEWER') {
      const [mine, shared] = await Promise.all([
        this.subscriptionsService.findAll(user.id),
        this.subscriptionsService.findSharedWith(user.id),
      ]);
      return { mine, shared };
    }
    return this.subscriptionsService.findAll(user.id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Update a subscription' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.update(id, dto.name, dto.nodeIds, user.id, dto.externalNodeIds, dto);
  }

  @Post(':id/refresh-token')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Regenerate subscription token' })
  refreshToken(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.refreshToken(id, user.id);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.remove(id, user.id);
  }

  // ─── Share management ──────────────────────────────────────────────────────

  @Post(':id/shares')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Share subscription with a VIEWER user' })
  addShare(
    @Param('id') id: string,
    @Body('userId') userId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.addShare(id, userId, user.id);
  }

  @Delete(':id/shares/:userId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Remove subscription share from a user' })
  removeShare(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.removeShare(id, userId, user.id);
  }

  @Get(':id/shares')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'List users this subscription is shared with' })
  listShares(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.listShares(id, user.id);
  }

  // ─── Public links (owner token) ───────────────────────────────────────────

  /** Public — Base64 universal subscription (V2Ray / Xray compatible) */
  @Get('link/:token')
  @ApiOperation({ summary: 'Base64 universal subscription content' })
  async getContent(@Param('token') token: string, @Res() res: Response, @Query('profile') profile?: string,
    @Headers('user-agent') userAgent?: string) {
    const content = await this.subscriptionsService.generateContent(token, clientProfile(profile, userAgent));
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('User-Agent');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=0');
    res.send(content);
  }

  /** Public — Clash / Mihomo YAML subscription */
  @Get('link/:token/clash')
  @ApiOperation({ summary: 'Clash / Mihomo YAML subscription content' })
  async getClashContent(@Param('token') token: string, @Res() res: Response, @Query('profile') profile?: string,
    @Headers('user-agent') userAgent?: string) {
    const { content, name } = await this.subscriptionsService.generateClashContent(token, clientProfile(profile, userAgent));
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('User-Agent');
    const filename = encodeURIComponent(name) + '.yaml';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(content);
  }

  /** Public — Sing-box JSON subscription */
  @Get('link/:token/singbox')
  @ApiOperation({ summary: 'Sing-box JSON subscription content' })
  async getSingboxContent(@Param('token') token: string, @Res() res: Response) {
    const content = await this.subscriptionsService.generateSingboxContent(token);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="singbox.json"');
    res.send(content);
  }

  /** Public — HomeProxy (OpenWrt router) full sing-box config */
  @Get('link/:token/homeproxy')
  @ApiOperation({ summary: 'HomeProxy (OpenWrt) full sing-box JSON — router transparent proxy' })
  async getHomeProxyContent(@Param('token') token: string, @Res() res: Response) {
    const content = await this.subscriptionsService.generateHomeProxyContent(token);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="homeproxy-singbox.json"');
    res.send(content);
  }

  // ─── Public links (shareToken — VIEWER) ───────────────────────────────────

  /** Public — VIEWER shareToken Base64 */
  @Get('share/:shareToken')
  @ApiOperation({ summary: 'VIEWER shared subscription — Base64 universal' })
  async getShareContent(@Param('shareToken') shareToken: string, @Res() res: Response, @Query('profile') profile?: string,
    @Headers('user-agent') userAgent?: string) {
    const content = await this.subscriptionsService.generateContentByShareToken(shareToken, clientProfile(profile, userAgent));
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('User-Agent');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=0');
    res.send(content);
  }

  /** Public — VIEWER shareToken Clash YAML */
  @Get('share/:shareToken/clash')
  @ApiOperation({ summary: 'VIEWER shared subscription — Clash YAML' })
  async getShareClashContent(@Param('shareToken') shareToken: string, @Res() res: Response, @Query('profile') profile?: string,
    @Headers('user-agent') userAgent?: string) {
    const { content, name } = await this.subscriptionsService.generateClashContentByShareToken(shareToken, clientProfile(profile, userAgent));
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('User-Agent');
    const filename = encodeURIComponent(name) + '.yaml';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(content);
  }

  /** Public — VIEWER shareToken Sing-box JSON */
  @Get('share/:shareToken/homeproxy')
  async getShareHomeProxyContent(@Param('shareToken') shareToken: string, @Res() res: Response) {
    const content = await this.subscriptionsService.generateHomeProxyContentByShareToken(shareToken);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="homeproxy-singbox.json"');
    res.send(content);
  }

  @Get('share/:shareToken/singbox')
  @ApiOperation({ summary: 'VIEWER shared subscription — Sing-box JSON' })
  async getShareSingboxContent(@Param('shareToken') shareToken: string, @Res() res: Response) {
    const content = await this.subscriptionsService.generateSingboxContentByShareToken(shareToken);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="singbox.json"');
    res.send(content);
  }
}
