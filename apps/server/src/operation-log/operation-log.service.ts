import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface CreateOperationLogParams {
  ownerId?: string | null;
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

export interface LogReader { id: string; role: string }

@Injectable()
export class OperationLogService {
  constructor(private prisma: PrismaService) {}

  async createLog(params: CreateOperationLogParams) {
    let ownerId = params.ownerId;
    if (ownerId === undefined && params.resourceId) {
      const resource = params.resourceType === 'node'
        ? await this.prisma.node.findUnique({ where: { id: params.resourceId }, select: { userId: true } })
        : params.resourceType === 'server'
          ? await this.prisma.server.findUnique({ where: { id: params.resourceId }, select: { userId: true } })
          : null;
      ownerId = resource?.userId ?? null;
    }
    return this.prisma.operationLog.create({ data: { ...params, ownerId: ownerId ?? null } });
  }

  /** Recent operation logs for a resource (no log text — call getLog for full text) */
  async listByResource(resourceType: string, resourceId: string, user: LogReader, limit = 20) {
    return this.prisma.operationLog.findMany({
      where: { resourceType, resourceId, ...this.scope(user) },
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
  async getByCorrelationId(correlationId: string, user: LogReader) {
    return this.prisma.operationLog.findFirst({
      where: { correlationId, ...this.scope(user) },
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
  async getLog(id: string, user: LogReader) {
    return this.prisma.operationLog.findFirst({
      where: { id, ...this.scope(user) },
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

  private scope(user: LogReader) {
    return user.role === 'ADMIN' ? {} : { ownerId: user.id };
  }
}
