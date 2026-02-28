import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

class CreateSubscriptionDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  nodeIds: string[];
}

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

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) {
    return this.subscriptionsService.remove(id);
  }

  /** Public endpoint — returns Base64 subscription content by token */
  @Get('link/:token')
  @ApiOperation({ summary: 'Public subscription content endpoint' })
  async getContent(@Param('token') token: string, @Res() res: Response) {
    const content = await this.subscriptionsService.generateContent(token);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=0');
    res.send(content);
  }
}
