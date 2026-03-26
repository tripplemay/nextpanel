import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertOpenRouterSettingDto {
  @ApiProperty({ description: 'OpenRouter API Key' })
  @IsString()
  apiKey: string;

  @ApiPropertyOptional({ description: '模型名称', default: 'anthropic/claude-sonnet-4' })
  @IsOptional()
  @IsString()
  model?: string;
}
