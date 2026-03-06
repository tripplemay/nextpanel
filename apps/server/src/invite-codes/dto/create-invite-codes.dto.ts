import { IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInviteCodesDto {
  @ApiProperty({ description: 'Number of codes to generate', default: 1 })
  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number = 1;

  @ApiProperty({ description: 'Max uses per code', default: 1 })
  @IsInt()
  @Min(1)
  maxUses: number = 1;
}
