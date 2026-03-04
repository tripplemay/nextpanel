import { IsString, IsNotEmpty, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_PROTOCOLS } from '../protocols/presets';

export class CreateNodeFromPresetDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  serverId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: SUPPORTED_PROTOCOLS, description: 'Protocol preset key' })
  @IsIn(SUPPORTED_PROTOCOLS)
  preset: string;
}
