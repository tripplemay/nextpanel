import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'OPERATOR', 'VIEWER')
  @ApiOperation({ summary: 'Create a subscription link' })
  create(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.subscriptionsService.create(dto.name, dto.nodeIds, user.id, dto.externalNodeIds);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List subscriptions — owners see all; VIEWERs see shared only' })
  findAll(@CurrentUser() user: { id: string; role: string }) {
    if (user.role === 'VIEWER') {
      return this.subscriptionsService.findSharedWith(user.id);
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
    return this.subscriptionsService.update(id, dto.name, dto.nodeIds, user.id, dto.externalNodeIds);
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
  async getContent(@Param('token') token: string, @Res() res: Response) {
    const content = await this.subscriptionsService.generateContent(token);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=0');
    res.send(content);
  }

  /** Public — Clash / Mihomo YAML subscription */
  @Get('link/:token/clash')
  @ApiOperation({ summary: 'Clash / Mihomo YAML subscription content' })
  async getClashContent(@Param('token') token: string, @Res() res: Response) {
    const { content, name } = await this.subscriptionsService.generateClashContent(token);
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

  // ─── Public links (shareToken — VIEWER) ───────────────────────────────────

  /** Public — VIEWER shareToken Base64 */
  @Get('share/:shareToken')
  @ApiOperation({ summary: 'VIEWER shared subscription — Base64 universal' })
  async getShareContent(@Param('shareToken') shareToken: string, @Res() res: Response) {
    const content = await this.subscriptionsService.generateContentByShareToken(shareToken);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=0');
    res.send(content);
  }

  /** Public — VIEWER shareToken Clash YAML */
  @Get('share/:shareToken/clash')
  @ApiOperation({ summary: 'VIEWER shared subscription — Clash YAML' })
  async getShareClashContent(@Param('shareToken') shareToken: string, @Res() res: Response) {
    const { content, name } = await this.subscriptionsService.generateClashContentByShareToken(shareToken);
    const filename = encodeURIComponent(name) + '.yaml';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(content);
  }

  /** Public — VIEWER shareToken Sing-box JSON */
  @Get('share/:shareToken/singbox')
  @ApiOperation({ summary: 'VIEWER shared subscription — Sing-box JSON' })
  async getShareSingboxContent(@Param('shareToken') shareToken: string, @Res() res: Response) {
    const content = await this.subscriptionsService.generateSingboxContentByShareToken(shareToken);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="singbox.json"');
    res.send(content);
  }
}
