import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExtractUrlDto {
  @ApiProperty({ description: '服务商页面 URL' })
  @IsString()
  url: string;
}
