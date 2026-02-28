import { IsString, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSubscriptionDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  nodeIds: string[];
}
