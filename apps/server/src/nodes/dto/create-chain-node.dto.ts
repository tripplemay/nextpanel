import { IsString, IsIn, IsNotEmpty, IsOptional, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SUPPORTED_PROTOCOLS, type SupportedProtocol } from '../protocols/presets';

export class CreateChainNodeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[^\r\n]+$/, { message: 'name must not contain line breaks' })
  name: string;

  @IsString()
  @IsIn(SUPPORTED_PROTOCOLS)
  @ApiProperty({ enum: SUPPORTED_PROTOCOLS, description: 'Protocol preset key' })
  preset: SupportedProtocol;

  @ApiProperty({ description: 'Entry server ID (user connects here)' })
  @IsString()
  entryServerId: string;

  @ApiPropertyOptional({
    enum: ['MANAGED_SERVER', 'SOCKS5'],
    default: 'MANAGED_SERVER',
    description: 'Chain exit type',
  })
  @IsOptional()
  @IsIn(['MANAGED_SERVER', 'SOCKS5'])
  exitType?: 'MANAGED_SERVER' | 'SOCKS5';

  @ApiPropertyOptional({ description: 'Managed exit server ID' })
  @ValidateIf((dto: CreateChainNodeDto) => (dto.exitType ?? 'MANAGED_SERVER') === 'MANAGED_SERVER')
  @IsString()
  @IsNotEmpty()
  exitServerId?: string;

  @ApiPropertyOptional({ description: 'Authenticated SOCKS5 URI' })
  @ValidateIf((dto: CreateChainNodeDto) => dto.exitType === 'SOCKS5')
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  @Matches(/^[^\r\n]+$/, { message: 'socksUri must not contain line breaks' })
  socksUri?: string;
}
