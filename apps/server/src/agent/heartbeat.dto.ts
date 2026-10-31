import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

class NodeStatusDto {
  @IsString() @MinLength(1) @MaxLength(128) nodeId!: string;
  @IsIn(['RUNNING', 'STOPPED', 'ERROR']) status!: 'RUNNING' | 'STOPPED' | 'ERROR';
}

class NodeTrafficDto {
  @IsString() @MinLength(1) @MaxLength(128) nodeId!: string;
  @IsNumber() @Min(0) upBytes!: number;
  @IsNumber() @Min(0) downBytes!: number;
}

class UsageCounterDto {
  @IsString() @Matches(/^(np-legacy|np-usage-[a-z0-9]{1,40})$/) email!: string;
  @IsString() @Matches(/^(0|[1-9][0-9]{0,17})$/) upBytes!: string;
  @IsString() @Matches(/^(0|[1-9][0-9]{0,17})$/) downBytes!: string;
}
class UsageSampleDto {
  @IsString() @MinLength(1) @MaxLength(128) nodeId!: string;
  @IsString() @MinLength(1) @MaxLength(128) sampleId!: string;
  @IsISO8601() sampledAt!: string;
  @IsInt() @Min(0) @Max(4294967295) uptime!: number;
  @IsOptional() @IsIn(['UNAVAILABLE', 'LIMIT']) error?: 'UNAVAILABLE' | 'LIMIT';
  @IsArray() @ArrayMaxSize(501) @ValidateNested({ each: true }) @Type(() => UsageCounterDto) users!: UsageCounterDto[];
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
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => UsageSampleDto)
  usageSamples?: UsageSampleDto[];
}
