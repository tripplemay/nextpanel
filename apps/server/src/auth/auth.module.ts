import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { CryptoService } from '../common/crypto/crypto.service';
import { WxWorkModule } from '../wxwork/wxwork.module';
import { OAuthStateService } from './oauth-state.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
      inject: [ConfigService],
    }),
    WxWorkModule,
  ],
  providers: [AuthService, JwtStrategy, CryptoService, OAuthStateService],
  controllers: [AuthController],
  exports: [AuthService, CryptoService],
})
export class AuthModule {}
