import {
  IsString,
  IsEnum,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  Max,
  IsObject,
  IsNotEmpty,
  Matches,
  MaxLength,
  IsFQDN,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Protocol, Implementation, Transport, TlsMode } from '@prisma/client';

export class NodeCredentialsDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  uuid?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  password?: string;

  @ApiPropertyOptional({ description: 'Shadowsocks cipher method' })
  @IsString()
  @IsOptional()
  method?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ description: 'REALITY private key (auto-generated if omitted)' })
  @IsString()
  @IsOptional()
  realityPrivateKey?: string;

  @ApiPropertyOptional({ description: 'REALITY public key (auto-generated if omitted)' })
  @IsString()
  @IsOptional()
  realityPublicKey?: string;

  @ApiPropertyOptional({ description: 'REALITY short ID (auto-generated for XHTTP if omitted)' })
  @IsString()
  @IsOptional()
  shortId?: string;

  @ApiPropertyOptional({ description: 'XHTTP request path (auto-generated if omitted)' })
  @IsString()
  @IsOptional()
  path?: string;
}

export class CreateNodeDto {
  @ApiProperty()
  @IsString()
  serverId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[^\r\n]+$/, { message: 'name must not contain line breaks' })
  name: string;

  @ApiProperty({ enum: Protocol })
  @IsEnum(Protocol)
  protocol: Protocol;

  @ApiPropertyOptional({ enum: Implementation })
  @IsEnum(Implementation)
  @IsOptional()
  implementation?: Implementation;

  @ApiPropertyOptional({ enum: Transport })
  @IsEnum(Transport)
  @IsOptional()
  transport?: Transport;

  @ApiPropertyOptional({ enum: TlsMode, default: 'NONE' })
  @IsEnum(TlsMode)
  @IsOptional()
  tls?: TlsMode;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(65535)
  listenPort: number;

  @ApiPropertyOptional()
  @IsFQDN({ require_tld: true, allow_underscores: false, allow_trailing_dot: false })
  @IsOptional()
  domain?: string;

  @ApiProperty({ type: NodeCredentialsDto })
  @IsObject()
  credentials: NodeCredentialsDto;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
