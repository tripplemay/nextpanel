import { IsString, IsArray, IsOptional, IsBoolean, ArrayMaxSize, IsIP, ArrayUnique, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSubscriptionDto {
  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  cfOnly?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: 3 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIP(undefined, { each: true })
  cfPreferredIps?: string[];

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  nodeIds: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  externalNodeIds?: string[];
}
