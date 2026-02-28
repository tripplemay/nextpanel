import * as crypto from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';

export interface GithubSecret {
  name: string;
  value: string;
  description: string;
}

export interface GithubConfigResult {
  yaml: string;
  secrets: GithubSecret[];
}

@Injectable()
export class PipelinesService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────────────

  async create(dto: CreatePipelineDto) {
    const githubTokenEnc = dto.githubToken
      ? this.crypto.encrypt(dto.githubToken)
      : null;

    return this.prisma.pipeline.create({
      data: {
        name: dto.name,
        repoUrl: dto.repoUrl,
        branch: dto.branch ?? 'main',
        githubTokenEnc,
        webhookSecret: crypto.randomBytes(8).toString('hex'),
        workDir: dto.workDir ?? '/opt/apps',
        buildCommands: dto.buildCommands ?? [],
        deployCommands: dto.deployCommands ?? [],
        serverIds: dto.serverIds,
        enabled: dto.enabled ?? true,
      },
    });
  }

  findAll() {
    return this.prisma.pipeline.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const p = await this.prisma.pipeline.findUnique({ where: { id } });
    if (!p) throw new NotFoundException(`Pipeline ${id} not found`);
    return p;
  }

  async update(id: string, dto: UpdatePipelineDto) {
    await this.findOne(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.githubToken !== undefined) {
      data.githubTokenEnc = dto.githubToken
        ? this.crypto.encrypt(dto.githubToken)
        : null;
      delete data.githubToken;
    }
    return this.prisma.pipeline.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.pipeline.delete({ where: { id } });
  }

  // ── GitHub Actions config generator ─────────────────────────────────────

  async generateGithubConfig(id: string): Promise<GithubConfigResult> {
    const pipeline = await this.prisma.pipeline.findUnique({ where: { id } });
    if (!pipeline) throw new NotFoundException(`Pipeline ${id} not found`);

    const servers = await this.prisma.server.findMany({
      where: { id: { in: pipeline.serverIds } },
    });

    const repoName =
      pipeline.repoUrl.split('/').pop()?.replace(/\.git$/, '') ?? 'repo';
    const multi = servers.length > 1;

    const secrets: GithubSecret[] = [];
    const sshSteps: string[] = [];

    for (let i = 0; i < servers.length; i++) {
      const server = servers[i];
      const prefix = multi ? `SERVER_${i + 1}_` : '';
      const sshAuth = this.crypto.decrypt(server.sshAuthEnc);
      const isKey = server.sshAuthType === 'KEY';
      const authSecretName = `${prefix}${isKey ? 'SSH_PRIVATE_KEY' : 'SSH_PASSWORD'}`;

      secrets.push(
        {
          name: `${prefix}SSH_HOST`,
          value: server.ip,
          description: `IP 地址 (${server.name})`,
        },
        {
          name: `${prefix}SSH_PORT`,
          value: String(server.sshPort),
          description: 'SSH 端口',
        },
        {
          name: `${prefix}SSH_USER`,
          value: server.sshUser,
          description: 'SSH 用户名',
        },
        {
          name: authSecretName,
          value: sshAuth,
          description: isKey ? 'SSH 私钥内容（-----BEGIN ... -----END ...）' : 'SSH 密码',
        },
      );

      const allCommands = [
        `cd ${pipeline.workDir}/${repoName}`,
        `git pull origin ${pipeline.branch}`,
        ...pipeline.buildCommands,
        ...pipeline.deployCommands,
      ]
        .map((cmd) => `            ${cmd}`)
        .join('\n');

      const authYaml = isKey
        ? `          key: \${{ secrets.${authSecretName} }}`
        : `          password: \${{ secrets.${authSecretName} }}`;

      const stepName = multi ? `Deploy to ${server.name}` : 'Deploy to VPS';

      sshSteps.push(
        [
          `      - name: ${stepName}`,
          `        uses: appleboy/ssh-action@v1.0.3`,
          `        with:`,
          `          host: \${{ secrets.${prefix}SSH_HOST }}`,
          `          username: \${{ secrets.${prefix}SSH_USER }}`,
          `          port: \${{ secrets.${prefix}SSH_PORT }}`,
          authYaml,
          `          script: |`,
          `            set -e`,
          allCommands,
        ].join('\n'),
      );
    }

    const yaml = [
      `name: Deploy — ${pipeline.name}`,
      ``,
      `on:`,
      `  push:`,
      `    branches: [${pipeline.branch}]`,
      `  workflow_dispatch:`,
      ``,
      `jobs:`,
      `  deploy:`,
      `    runs-on: ubuntu-latest`,
      `    steps:`,
      `      - name: Checkout code`,
      `        uses: actions/checkout@v4`,
      ``,
      sshSteps.join('\n\n'),
    ].join('\n');

    return { yaml, secrets };
  }
}
