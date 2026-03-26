import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertWxWorkSettingDto {
  @ApiProperty({ description: '企业ID' })
  @IsString()
  corpId: string;

  @ApiProperty({ description: '应用ID' })
  @IsString()
  agentId: string;

  @ApiProperty({ description: '应用密钥' })
  @IsString()
  secret: string;

  @ApiPropertyOptional({ description: 'API 代理地址（海外服务器访问微信 API 用）' })
  @IsOptional()
  @IsString()
  proxyUrl?: string;
}
