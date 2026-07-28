import { IsString, IsNotEmpty, IsFQDN } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpsertCloudflareSettingDto {
  @ApiProperty({ description: 'Cloudflare API token' })
  @IsString()
  @IsNotEmpty()
  apiToken: string;

  @ApiProperty({ description: 'Root domain managed by this Cloudflare account, e.g. example.com' })
  @IsFQDN({ require_tld: true, allow_underscores: false, allow_trailing_dot: false })
  @IsNotEmpty()
  domain: string;

  @ApiProperty({ description: 'Cloudflare Zone ID for the domain' })
  @IsString()
  @IsNotEmpty()
  zoneId: string;
}
