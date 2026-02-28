import { IsString, IsEnum, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Protocol, Implementation } from '@prisma/client';

export class CreateTemplateDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: Protocol })
  @IsEnum(Protocol)
  protocol: Protocol;

  @ApiPropertyOptional({ enum: Implementation })
  @IsEnum(Implementation)
  @IsOptional()
  implementation?: Implementation;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'JSON template string with {{variable}} placeholders' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  variables?: string[];
}
