import { IsString, IsArray, IsOptional, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRecommendDto {
  @ApiProperty() @IsString() categoryId: string;
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsString() price: string;
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) regions: string[];
  @ApiProperty() @IsString() link: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}
