import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma.service';

type Purpose = 'login' | 'bind';
const TTL_MS = 5 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class OAuthStateService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  callbackUri(purpose: Purpose): string {
    const panel = new URL(this.config.getOrThrow<string>('PANEL_URL'));
    if (!['https:', 'http:'].includes(panel.protocol)) throw new BadRequestException('PANEL_URL 无效');
    return new URL(purpose === 'bind' ? '/wxwork/bind-callback' : '/wxwork/callback', panel).href;
  }

  async issue(purpose: Purpose, res: Response, userId?: string) {
    const state = randomBytes(32).toString('hex');
    const browserToken = randomBytes(32).toString('hex');
    await this.prisma.oAuthState.create({ data: {
      id: hash(state), browserHash: hash(browserToken), purpose, userId: userId ?? null,
      expiresAt: new Date(Date.now() + TTL_MS),
    } });
    res.cookie(this.cookieName(purpose), browserToken, {
      ...this.cookieOptions(purpose), maxAge: TTL_MS,
    });
    res.setHeader('Cache-Control', 'no-store');
    return state;
  }

  async consume(purpose: Purpose, state: string, req: Request, res: Response, userId?: string) {
    const name = this.cookieName(purpose);
    const browserToken = (req.headers.cookie ?? '').split(';')
      .map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!/^[a-f0-9]{64}$/.test(state ?? '') || !/^[a-f0-9]{64}$/.test(browserToken ?? '')) {
      throw new BadRequestException('授权会话无效，请重新发起授权');
    }
    // Atomic consume prevents replay across concurrent callbacks and server processes.
    const { count } = await this.prisma.oAuthState.deleteMany({ where: {
      id: hash(state), browserHash: hash(browserToken!), purpose, userId: userId ?? null,
      expiresAt: { gt: new Date() },
    } });
    if (count !== 1) throw new BadRequestException('授权会话已失效，请重新发起授权');
    res.clearCookie(name, this.cookieOptions(purpose));
    res.setHeader('Cache-Control', 'no-store');
  }

  @Cron('*/10 * * * *')
  async purgeExpired() {
    await this.prisma.oAuthState.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }

  private cookieName(purpose: Purpose) { return `np_wxwork_${purpose}`; }
  private cookieOptions(purpose: Purpose) {
    return { httpOnly: true, secure: this.callbackUri(purpose).startsWith('https:'),
      sameSite: 'lax' as const, path: '/api/auth/wxwork' };
  }
}
