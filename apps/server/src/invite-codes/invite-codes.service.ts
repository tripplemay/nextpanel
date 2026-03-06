import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateInviteCodesDto } from './dto/create-invite-codes.dto';

@Injectable()
export class InviteCodesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateInviteCodesDto, adminId: string) {
    const data = Array.from({ length: dto.quantity }, () => ({
      maxUses: dto.maxUses,
      createdBy: adminId,
    }));
    await this.prisma.inviteCode.createMany({ data });
    return this.prisma.inviteCode.findMany({
      where: { createdBy: adminId },
      orderBy: { createdAt: 'desc' },
      take: dto.quantity,
    });
  }

  findAll() {
    return this.prisma.inviteCode.findMany({
      include: { creator: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(id: string) {
    const code = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException(`Invite code ${id} not found`);
    return this.prisma.inviteCode.delete({ where: { id } });
  }
}
