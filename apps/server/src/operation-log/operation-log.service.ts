import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface CreateOperationLogParams {
  resourceType: string;
  resourceId: string | null;
  resourceName: string;
  actorId: string | null;
  operation: string;
  correlationId: string | null;
  success: boolean;
  log: string | null;
  durationMs: number | null;
}

@Injectable()
export class OperationLogService {
  constructor(private prisma: PrismaService) {}

  async createLog(params: CreateOperationLogParams) {
    return this.prisma.operationLog.create({ data: params });
  }

  /** Recent operation logs for a resource (no log text — call getLog for full text) */
  async listByResource(resourceType: string, resourceId: string, limit = 20) {
    return this.prisma.operationLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        resourceType: true,
        resourceName: true,
        actorId: true,
        operation: true,
        correlationId: true,
        success: true,
        durationMs: true,
        createdAt: true,
      },
    });
  }

  /** Find the OperationLog linked to an AuditLog via correlationId (includes log text for UI display) */
  async getByCorrelationId(correlationId: string) {
    return this.prisma.operationLog.findFirst({
      where: { correlationId },
      select: {
        id: true,
        resourceType: true,
        resourceId: true,
        resourceName: true,
        operation: true,
        correlationId: true,
        success: true,
        log: true,
        durationMs: true,
        createdAt: true,
      },
    });
  }

  /** Full detail for one record including log text */
  async getLog(id: string) {
    return this.prisma.operationLog.findUnique({
      where: { id },
      select: {
        id: true,
        resourceType: true,
        resourceName: true,
        operation: true,
        correlationId: true,
        success: true,
        log: true,
        durationMs: true,
        createdAt: true,
      },
    });
  }
}
