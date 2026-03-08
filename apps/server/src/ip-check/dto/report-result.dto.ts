import { IsString, IsOptional, IsBoolean, IsObject } from 'class-validator';

export class ReportIpCheckResultDto {
  @IsString()
  agentToken: string;

  @IsString()
  @IsOptional()
  netflix?: string;

  @IsString()
  @IsOptional()
  netflixRegion?: string;

  @IsString()
  @IsOptional()
  disney?: string;

  @IsString()
  @IsOptional()
  disneyRegion?: string;

  @IsString()
  @IsOptional()
  youtube?: string;

  @IsString()
  @IsOptional()
  youtubeRegion?: string;

  @IsString()
  @IsOptional()
  hulu?: string;

  @IsString()
  @IsOptional()
  bilibili?: string;

  @IsString()
  @IsOptional()
  openai?: string;

  @IsString()
  @IsOptional()
  claude?: string;

  @IsString()
  @IsOptional()
  gemini?: string;

  @IsObject()
  @IsOptional()
  routeData?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  success?: boolean;

  @IsString()
  @IsOptional()
  error?: string;
}
