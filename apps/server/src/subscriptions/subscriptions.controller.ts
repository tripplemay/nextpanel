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
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a subscription link' })
  create(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.create(dto.name, dto.nodeIds, user.id);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List subscriptions for current user' })
  findAll(@CurrentUser() user: { id: string }) {
    return this.subscriptionsService.findAll(user.id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update a subscription' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.update(id, dto.name, dto.nodeIds, user.id);
  }

  @Post(':id/refresh-token')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Regenerate subscription token' })
  refreshToken(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.refreshToken(id, user.id);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.subscriptionsService.remove(id, user.id);
  }

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
}
