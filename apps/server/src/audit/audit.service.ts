import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

interface LogParams {
  actorId: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  diff?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: LogParams) {
    return this.prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        diff: params.diff as Prisma.InputJsonValue | undefined,
        ip: params.ip,
      },
    });
  }

  async findAll(page = 1, pageSize = 20) {
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { timestamp: 'desc' },
        include: { actor: { select: { username: true } } },
      }),
      this.prisma.auditLog.count(),
    ]);
    return { data, total, page, pageSize };
  }
}
