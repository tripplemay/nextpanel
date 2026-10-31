import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, IsBoolean, ArrayMaxSize, ArrayUnique, IsIP, ValidateIf } from 'class-validator';

export class UpdateSubscriptionDto {
  @ApiPropertyOptional()
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  nodeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  externalNodeIds?: string[];
}
