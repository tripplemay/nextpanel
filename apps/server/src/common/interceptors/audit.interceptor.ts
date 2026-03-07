import { randomUUID } from 'crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_KEY, type AuditMeta } from '../decorators/audit.decorator';

/**
 * Global interceptor that reads @Audit() metadata and automatically writes
 * an AuditLog entry after the handler returns a value.
 *
 * NOTE: SSE (Server-Sent Events) endpoints return an Observable and do NOT
 * go through this interceptor's tap. Those endpoints must write AuditLog
 * manually in the controller. This is intentional by design.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta>(AUDIT_KEY, context.getHandler());

    // No @Audit decorator — pass through untouched
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<{
      user?: { id: string };
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      correlationId?: string;
    }>();

    // Generate correlationId BEFORE handler runs so controller can read it
    const correlationId = randomUUID();
    req.correlationId = correlationId;

    return next.handle().pipe(
      tap((response: unknown) => {
        const user = req.user;
        if (!user) return;

        // Prefer id from response body (CREATE returns the new entity);
        // fall back to route param for UPDATE / DELETE / action endpoints
        const responseId =
          response !== null &&
          typeof response === 'object' &&
          'id' in response &&
          typeof (response as Record<string, unknown>).id === 'string'
            ? (response as { id: string }).id
            : undefined;
        const resourceId = responseId ?? req.params?.id;

        // Capture request body as diff when it has meaningful content
        const body = req.body;
        const diff =
          body && typeof body === 'object' && Object.keys(body).length > 0
            ? (body as Record<string, unknown>)
            : undefined;

        void this.auditService.log({
          actorId: user.id,
          action: meta.action,
          resource: meta.resource,
          resourceId,
          diff,
          ip: (req.headers?.['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
          correlationId,
        });
      }),
    );
  }
}
