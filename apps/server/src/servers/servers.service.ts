import { Injectable, NotFoundException } from '@nestjs/common';
import { NodeSSH } from 'node-ssh';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';

@Injectable()
export class ServersService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  async create(dto: CreateServerDto) {
    const sshAuthEnc = this.crypto.encrypt(dto.sshAuth);
    return this.prisma.server.create({
      data: {
        name: dto.name,
        region: dto.region,
        provider: dto.provider,
        ip: dto.ip,
        sshPort: dto.sshPort ?? 22,
        sshUser: dto.sshUser ?? 'root',
        sshAuthType: dto.sshAuthType,
        sshAuthEnc,
        tags: dto.tags ?? [],
        notes: dto.notes,
      },
      select: this.safeSelect(),
    });
  }

  async findAll() {
    return this.prisma.server.findMany({
      select: this.safeSelect(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const server = await this.prisma.server.findUnique({
      where: { id },
      select: this.safeSelect(),
    });
    if (!server) throw new NotFoundException(`Server ${id} not found`);
    return server;
  }

  async update(id: string, dto: UpdateServerDto) {
    await this.findOne(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.sshAuth) {
      data.sshAuthEnc = this.crypto.encrypt(dto.sshAuth);
      delete data.sshAuth;
    }
    return this.prisma.server.update({
      where: { id },
      data,
      select: this.safeSelect(),
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.server.delete({ where: { id } });
  }

  async testSsh(id: string): Promise<{ success: boolean; message: string }> {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException(`Server ${id} not found`);

    const sshAuth = this.crypto.decrypt(server.sshAuthEnc);
    const ssh = new NodeSSH();

    try {
      const connectOpts: Parameters<NodeSSH['connect']>[0] = {
        host: server.ip,
        port: server.sshPort,
        username: server.sshUser,
        readyTimeout: 10000,
      };

      if (server.sshAuthType === 'KEY') {
        connectOpts.privateKey = sshAuth;
      } else {
        connectOpts.password = sshAuth;
      }

      await ssh.connect(connectOpts);
      const result = await ssh.execCommand('echo ok');
      ssh.dispose();

      return {
        success: result.stdout.trim() === 'ok',
        message: 'SSH connection successful',
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  }

  /** Returns a select object that excludes sshAuthEnc */
  private safeSelect() {
    return {
      id: true,
      name: true,
      region: true,
      provider: true,
      ip: true,
      sshPort: true,
      sshUser: true,
      sshAuthType: true,
      tags: true,
      notes: true,
      status: true,
      cpuUsage: true,
      memUsage: true,
      diskUsage: true,
      lastSeenAt: true,
      agentVersion: true,
      agentToken: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}
