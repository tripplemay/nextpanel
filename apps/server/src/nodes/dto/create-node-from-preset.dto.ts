import { IsString, IsNotEmpty, IsIn, IsOptional, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SUPPORTED_PROTOCOLS, type SupportedProtocol } from '../protocols/presets';

export class CreateNodeFromPresetDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  serverId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[^\r\n]+$/, { message: 'name must not contain line breaks' })
  name: string;

  @ApiProperty({ enum: SUPPORTED_PROTOCOLS, description: 'Protocol preset key' })
  @IsIn(SUPPORTED_PROTOCOLS)
  preset: SupportedProtocol;

  @ApiPropertyOptional({ enum: ['packet-up', 'stream-up'] })
  @IsOptional()
  @IsIn(['packet-up', 'stream-up'])
  xhttpMode?: 'packet-up' | 'stream-up';
}
