import { IsString, IsOptional, IsArray, IsBoolean, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePipelineDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'https://github.com/owner/repo' })
  @IsString()
  repoUrl: string;

  @ApiPropertyOptional({ default: 'main' })
  @IsString()
  @IsOptional()
  branch?: string;

  @ApiPropertyOptional({ description: 'GitHub Personal Access Token (for private repos)' })
  @IsString()
  @IsOptional()
  githubToken?: string;

  @ApiPropertyOptional({ default: '/opt/apps' })
  @IsString()
  @IsOptional()
  workDir?: string;

  @ApiPropertyOptional({ type: [String], example: ['npm install', 'npm run build'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  buildCommands?: string[];

  @ApiPropertyOptional({ type: [String], example: ['pm2 restart app'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  deployCommands?: string[];

  @ApiProperty({ type: [String], description: 'Target server IDs' })
  @IsArray()
  @IsString({ each: true })
  serverIds: string[];

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
