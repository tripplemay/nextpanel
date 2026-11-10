import { Type } from 'class-transformer';
import { Equals, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength, IsDefined, IsObject, ValidateNested } from 'class-validator';

export const systemInfoKeys = [
  'cpuModel', 'cpuLogicalCores', 'architecture', 'memoryTotalBytes',
  'rootTotalBytes', 'rootFsType', 'osName', 'osVersion', 'kernelVersion',
  'virtualizationSystem', 'virtualizationRole',
] as const;

export class SystemInfoValuesDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(256) cpuModel?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1048576) cpuLogicalCores?: number;
  @IsOptional() @IsIn(['amd64', 'arm64']) architecture?: string;
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) memoryTotalBytes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) rootTotalBytes?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) rootFsType?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) osName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) osVersion?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) kernelVersion?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) virtualizationSystem?: string;
  @IsOptional() @IsIn(['host', 'guest', 'unknown']) virtualizationRole?: string;
}

export class SystemInfoDto {
  @IsString() @MinLength(1) @MaxLength(128) agentToken!: string;
  @IsString() @MinLength(1) @MaxLength(64) agentVersion!: string;
  @Equals(1) schemaVersion!: number;
  @IsISO8601({ strict: true }) collectedAt!: string;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => SystemInfoValuesDto) values!: SystemInfoValuesDto;
}
