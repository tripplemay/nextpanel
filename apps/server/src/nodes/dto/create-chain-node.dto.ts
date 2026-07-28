import { IsString, IsIn, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_PROTOCOLS, type SupportedProtocol } from '../protocols/presets';

export class CreateChainNodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[^\r\n]+$/, { message: 'name must not contain line breaks' })
  name: string;

  @IsString()
  @IsIn(SUPPORTED_PROTOCOLS)
  @ApiProperty({ enum: SUPPORTED_PROTOCOLS, description: 'Protocol preset key' })
  preset: SupportedProtocol;

  @ApiProperty({ description: 'Entry server ID (user connects here)' })
  @IsString()
  entryServerId: string;

  @ApiProperty({ description: 'Exit server ID (traffic exits here)' })
  @IsString()
  exitServerId: string;
}
