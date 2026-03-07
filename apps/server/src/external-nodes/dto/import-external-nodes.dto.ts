import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportExternalNodesDto {
  @ApiProperty({ description: 'Raw URI(s) or Base64 subscription content' })
  @IsString()
  @IsNotEmpty()
  text!: string;
}
