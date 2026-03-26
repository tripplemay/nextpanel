import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CreateRecommendDto } from './dto/create-recommend.dto';
import { UpdateRecommendDto } from './dto/update-recommend.dto';

@Injectable()
export class RecommendsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll() {
    return this.prisma.serverRecommendCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        recommends: {
          include: {
            recommend: true,
          },
          orderBy: { recommend: { sortOrder: 'asc' } },
        },
      },
    });
  }

  // ── Category CRUD ──────────────────────────────────────────────────────

  async createCategory(dto: CreateCategoryDto) {
    return this.prisma.serverRecommendCategory.create({
      data: {
        name: dto.name,
        description: dto.description,
        color: dto.color,
        featuredId: dto.featuredId,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.serverRecommendCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('分类不存在');
    return this.prisma.serverRecommendCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.featuredId !== undefined && { featuredId: dto.featuredId }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async removeCategory(id: string) {
    const existing = await this.prisma.serverRecommendCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('分类不存在');
    await this.prisma.serverRecommendCategory.delete({ where: { id } });
  }

  // ── Recommend CRUD ─────────────────────────────────────────────────────

  async createRecommend(dto: CreateRecommendDto) {
    return this.prisma.serverRecommend.create({
      data: {
        name: dto.name,
        price: dto.price,
        regions: dto.regions,
        link: dto.link,
        sortOrder: dto.sortOrder ?? 0,
        categories: {
          create: dto.categoryIds.map((categoryId) => ({ categoryId })),
        },
      },
      include: { categories: { include: { category: true } } },
    });
  }

  async updateRecommend(id: string, dto: UpdateRecommendDto) {
    const existing = await this.prisma.serverRecommend.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('推荐不存在');

    return this.prisma.serverRecommend.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.regions !== undefined && { regions: dto.regions }),
        ...(dto.link !== undefined && { link: dto.link }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        ...(dto.categoryIds !== undefined && {
          categories: {
            deleteMany: {},
            create: dto.categoryIds.map((categoryId) => ({ categoryId })),
          },
        }),
      },
      include: { categories: { include: { category: true } } },
    });
  }

  async removeRecommend(id: string) {
    const existing = await this.prisma.serverRecommend.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('推荐不存在');
    await this.prisma.serverRecommend.delete({ where: { id } });
  }
}
