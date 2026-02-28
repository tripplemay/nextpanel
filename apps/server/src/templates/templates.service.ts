import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { PartialType } from '@nestjs/swagger';

class UpdateTemplateDto extends PartialType(CreateTemplateDto) {}

@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreateTemplateDto, createdById: string) {
    return this.prisma.template.create({
      data: {
        ...dto,
        variables: dto.variables ?? [],
        createdById,
      },
    });
  }

  findAll() {
    return this.prisma.template.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { username: true } } },
    });
  }

  async findOne(id: string) {
    const tpl = await this.prisma.template.findUnique({
      where: { id },
      include: { createdBy: { select: { username: true } } },
    });
    if (!tpl) throw new NotFoundException(`Template ${id} not found`);
    return tpl;
  }

  async update(id: string, dto: UpdateTemplateDto) {
    await this.findOne(id);
    return this.prisma.template.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.template.delete({ where: { id } });
  }

  /** Render template content by replacing {{variable}} placeholders */
  render(content: string, vars: Record<string, string>): string {
    return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
  }
}
