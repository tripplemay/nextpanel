import { Injectable, Logger, MessageEvent, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { connectSsh } from '../nodes/ssh/ssh.util';

@Injectable()
export class AutoSetupService {
  private readonly logger = new Logger(AutoSetupService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  setupStream(
    serverId: string,
    _templateIds: string[],
    _actorId?: string,
  ): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const emit = (log: string) =>
        subscriber.next({ data: { log } } as MessageEvent);

      this.run(serverId, emit)
        .then((success) => {
          subscriber.next({ data: { done: true, success } } as MessageEvent);
          subscriber.complete();
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          emit(`[ERROR] ${msg}`);
          subscriber.next({ data: { done: true, success: false } } as MessageEvent);
          subscriber.complete();
        });
    });
  }

  private async run(
    serverId: string,
    log: (msg: string) => void,
  ): Promise<boolean> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);

    const sshAuth = this.crypto.decrypt(server.sshAuthEnc);

    log(`=== 开始自动配置服务器: ${server.name} (${server.ip}) ===`);

    log('正在建立 SSH 连接...');
    const ssh = await connectSsh({
      host: server.ip,
      port: server.sshPort,
      username: server.sshUser,
      authType: server.sshAuthType as 'KEY' | 'PASSWORD',
      auth: sshAuth,
      readyTimeout: 15000,
    });
    log(`SSH 已连接到 ${server.ip}:${server.sshPort}`);
    ssh.dispose();

    log('\n=== 自动配置完成 ===');
    return true;
  }
}
