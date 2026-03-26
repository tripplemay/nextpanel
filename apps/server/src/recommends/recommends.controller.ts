import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  UseGuards,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RecommendsService } from './recommends.service';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateRecommendDto } from './dto/create-recommend.dto';
import { UpdateRecommendDto } from './dto/update-recommend.dto';
import { ExtractUrlDto } from './dto/extract-url.dto';

@ApiTags('recommends')
@ApiBearerAuth()
@Controller('recommends')
export class RecommendsController {
  constructor(
    private readonly recommendsService: RecommendsService,
    private readonly openRouterService: OpenRouterService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List all categories with recommends' })
  listAll() {
    return this.recommendsService.listAll();
  }

  // ── Category ───────────────────────────────────────────────────────────

  @Post('categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create recommend category' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.recommendsService.createCategory(dto);
  }

  @Patch('categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update recommend category' })
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.recommendsService.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete recommend category' })
  async removeCategory(@Param('id') id: string) {
    await this.recommendsService.removeCategory(id);
  }

  // ── Extract ────────────────────────────────────────────────────────────

  @Post('extract')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Extract provider info from URL via AI' })
  extract(@Body() dto: ExtractUrlDto) {
    return this.openRouterService.extractFromUrl(dto.url);
  }

  // ── Recommend ──────────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create recommend' })
  createRecommend(@Body() dto: CreateRecommendDto) {
    return this.recommendsService.createRecommend(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update recommend' })
  updateRecommend(@Param('id') id: string, @Body() dto: UpdateRecommendDto) {
    return this.recommendsService.updateRecommend(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete recommend' })
  async removeRecommend(@Param('id') id: string) {
    await this.recommendsService.removeRecommend(id);
  }
}
