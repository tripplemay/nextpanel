import { SetMetadata } from '@nestjs/common';
import type { AuditAction } from '@prisma/client';

export const AUDIT_KEY = 'audit_metadata';

export interface AuditMeta {
  action: AuditAction;
  resource: string;
}

/** Mark a controller method for automatic audit logging via AuditInterceptor */
export const Audit = (action: AuditAction, resource: string): MethodDecorator =>
  SetMetadata(AUDIT_KEY, { action, resource } satisfies AuditMeta);
