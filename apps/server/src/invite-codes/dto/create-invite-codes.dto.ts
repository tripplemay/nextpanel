import { IsInt, Min, Max, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({ description: 'Custom invite code (alphanumeric only). When set, quantity is ignored and exactly one code is created.' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9]+$/, { message: '邀请码只能包含字母和数字' })
  customCode?: string;
}
