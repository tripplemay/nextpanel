import { IsIP, IsOptional, IsString, MaxLength, IsNotEmpty } from 'class-validator';

export class CheckCfAccessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  nodeId: string;

  @IsOptional()
  @IsIP()
  ip?: string;
}
