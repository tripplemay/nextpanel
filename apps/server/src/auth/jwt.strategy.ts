import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; role: string; jti?: string; exp?: number }) {
    if (payload.jti) {
      const revoked = await this.authService.isTokenRevoked(payload.jti);
      if (revoked) throw new UnauthorizedException();
    }

    const user = await this.authService.validateById(payload.sub);
    if (!user) throw new UnauthorizedException();

    // Attach jti and exp so logout endpoint can read them via @CurrentUser()
    return { ...user, jti: payload.jti, tokenExp: payload.exp };
  }
}
