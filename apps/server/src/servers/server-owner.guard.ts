import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ServersService } from './servers.service';

@Injectable()
export class ServerOwnerGuard implements CanActivate {
  constructor(private readonly servers: ServersService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    // Run before Nest opens SSE headers, including when global interceptors are present.
    await this.servers.findOne(request.params.id, request.user.id);
    return true;
  }
}
