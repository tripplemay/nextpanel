import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.jwt.sign({ sub: user.id, role: user.role });
    return {
      accessToken: token,
      user: { id: user.id, username: user.username, role: user.role },
    };
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
}
