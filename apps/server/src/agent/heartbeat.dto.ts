import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

class NodeStatusDto {
  @IsString() @MinLength(1) @MaxLength(128) nodeId!: string;
  @IsIn(['RUNNING', 'STOPPED', 'ERROR']) status!: 'RUNNING' | 'STOPPED' | 'ERROR';
}

class NodeTrafficDto {
  @IsString() @MinLength(1) @MaxLength(128) nodeId!: string;
  @IsNumber() @Min(0) upBytes!: number;
  @IsNumber() @Min(0) downBytes!: number;
}

export class HeartbeatDto {
  @IsString() @MinLength(1) @MaxLength(128) agentToken!: string;
  @IsString() @MinLength(1) @MaxLength(64) agentVersion!: string;
  @IsOptional() @IsIn(['amd64', 'arm64']) architecture?: 'amd64' | 'arm64';
  @IsNumber() @Min(0) @Max(100) cpu!: number;
  @IsNumber() @Min(0) @Max(100) mem!: number;
  @IsNumber() @Min(0) @Max(100) disk!: number;
  @IsNumber() @Min(0) networkIn!: number;
  @IsNumber() @Min(0) networkOut!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => NodeStatusDto)
  nodeStatuses?: NodeStatusDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => NodeTrafficDto)
  nodeTraffic?: NodeTrafficDto[];
}
