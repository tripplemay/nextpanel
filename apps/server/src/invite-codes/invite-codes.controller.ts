import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { InviteCodesService } from './invite-codes.service';
import { CreateInviteCodesDto } from './dto/create-invite-codes.dto';

@ApiTags('invite-codes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('invite-codes')
export class InviteCodesController {
  constructor(private inviteCodesService: InviteCodesService) {}

  @Post()
  @ApiOperation({ summary: 'Generate invite code(s)' })
  create(
    @Body() dto: CreateInviteCodesDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.inviteCodesService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List all invite codes' })
  findAll() {
    return this.inviteCodesService.findAll();
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an invite code' })
  remove(@Param('id') id: string) {
    return this.inviteCodesService.remove(id);
  }
}
