import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });

    // Use constant-time path to avoid username enumeration
    if (!user) {
      await bcrypt.compare(dto.password, '$2b$12$placeholderHashToAvoidTimingLeak000000000000000000000');
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remainingMin = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(`账号已锁定，请 ${remainingMin} 分钟后再试`);
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      const attempts = user.loginAttempts + 1;
      const update: { loginAttempts: number; lockedUntil?: Date } = { loginAttempts: attempts };
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        update.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
        update.loginAttempts = 0;
      }
      await this.prisma.user.update({ where: { id: user.id }, data: update });
      throw new UnauthorizedException('Invalid credentials');
    }

    // Reset failed attempts on successful login
    if (user.loginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { loginAttempts: 0, lockedUntil: null },
      });
    }

    const jti = randomUUID();
    const token = this.jwt.sign({ sub: user.id, role: user.role, jti });
    return {
      accessToken: token,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  async logout(jti: string, expiresAt: Date): Promise<void> {
    await this.prisma.revokedToken.upsert({
      where: { jti },
      create: { jti, expiresAt },
      update: {},
    });
  }

  async isTokenRevoked(jti: string): Promise<boolean> {
    const token = await this.prisma.revokedToken.findUnique({ where: { jti } });
    return !!token;
  }

  async register(dto: RegisterDto) {
    const invite = await this.prisma.inviteCode.findUnique({
      where: { code: dto.inviteCode },
    });

    if (!invite || invite.usedCount >= invite.maxUses) {
      throw new BadRequestException('Invalid or exhausted invite code');
    }

    const exists = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (exists) throw new ConflictException('Username already taken');

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const [user] = await this.prisma.$transaction([
      this.prisma.user.create({
        data: { username: dto.username, passwordHash, role: 'OPERATOR' },
      }),
      this.prisma.inviteCode.update({
        where: { id: invite.id },
        data: { usedCount: { increment: 1 } },
      }),
    ]);

    return { id: user.id, username: user.username, role: user.role };
  }

  async validateById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('当前密码不正确');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  /** Purge expired revoked tokens daily to keep the table small */
  @Cron('0 3 * * *')
  async purgeExpiredTokens(): Promise<void> {
    await this.prisma.revokedToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
