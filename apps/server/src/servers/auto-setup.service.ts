import { Injectable, Logger, MessageEvent, NotFoundException, BadRequestException } from '@nestjs/common';
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

  async setupStream(
    serverId: string,
    _templateIds: string[],
    actorId: string,
  ): Promise<Observable<MessageEvent>> {
    const server = await this.prisma.server.findFirst({ where: { id: serverId, userId: actorId } });
    if (!server) throw new NotFoundException(`Server ${serverId} not found`);
    if (_templateIds.length > 0) {
      throw new BadRequestException('模板自动配置已停用，请使用节点协议预设创建并部署节点');
    }
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

    if (!server.sshAuthEnc) {
      throw new BadRequestException('SSH 凭证已销毁，请先在服务器详情页恢复凭证');
    }
    const sshAuth = this.crypto.decrypt(server.sshAuthEnc);

    log(`=== 开始 SSH 连接检查: ${server.name} (${server.ip}) ===`);

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

    log('\n=== SSH 连接检查完成；未修改服务器配置，请使用节点协议预设部署 ===');
    return true;
  }
}
