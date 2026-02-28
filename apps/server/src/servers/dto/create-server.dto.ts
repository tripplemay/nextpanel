import {
  IsString,
  IsIP,
  IsInt,
  IsEnum,
  IsOptional,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SshAuthType } from '@prisma/client';

export class CreateServerDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  region: string;

  @ApiProperty()
  @IsString()
  provider: string;

  @ApiProperty()
  @IsIP()
  ip: string;

  @ApiPropertyOptional({ default: 22 })
  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  sshPort?: number;

  @ApiPropertyOptional({ default: 'root' })
  @IsString()
  @IsOptional()
  sshUser?: string;

  @ApiProperty({ enum: SshAuthType })
  @IsEnum(SshAuthType)
  sshAuthType: SshAuthType;

  @ApiProperty({ description: 'PEM private key or plaintext password' })
  @IsString()
  sshAuth: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
