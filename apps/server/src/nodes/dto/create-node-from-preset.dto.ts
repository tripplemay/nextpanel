import { IsString, IsNotEmpty, IsIn, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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
}
