import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({
      select: { id: true, username: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateRole(id: string, role: UserRole, requesterId: string) {
    if (id === requesterId) {
      throw new ForbiddenException('Cannot change your own role');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (user.role === 'ADMIN') {
      throw new ForbiddenException('Cannot change role of another ADMIN');
    }
    return this.prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, username: true, role: true, createdAt: true },
    });
  }

  async remove(id: string, requesterId: string) {
    if (id === requesterId) {
      throw new ForbiddenException('Cannot delete yourself');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    if (user.role === 'ADMIN') {
      const adminCount = await this.prisma.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot delete the last ADMIN');
      }
    }
    return this.prisma.user.delete({ where: { id } });
  }
}
