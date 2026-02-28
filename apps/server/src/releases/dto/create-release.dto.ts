import { IsString, IsArray, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReleaseStrategy } from '@prisma/client';

export class CreateReleaseDto {
  @ApiProperty()
  @IsString()
  templateId: string;

  @ApiProperty({ type: [String], description: 'Server IDs to deploy to' })
  @IsArray()
  @IsString({ each: true })
  targets: string[];

  @ApiProperty({ enum: ReleaseStrategy })
  @IsEnum(ReleaseStrategy)
  strategy: ReleaseStrategy;

  @ApiPropertyOptional({ type: Object })
  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;
}
