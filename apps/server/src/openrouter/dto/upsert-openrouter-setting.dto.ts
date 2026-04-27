import { IsString, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertOpenRouterSettingDto {
  @ApiProperty({ description: 'API Key (encrypted at rest)' })
  @IsString()
  apiKey: string;

  @ApiPropertyOptional({
    description: 'OpenAI-compatible API base URL',
    default: 'https://openrouter.ai/api/v1',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  baseURL?: string;

  @ApiPropertyOptional({ description: '模型名称', default: 'anthropic/claude-sonnet-4' })
  @IsOptional()
  @IsString()
  model?: string;
}
