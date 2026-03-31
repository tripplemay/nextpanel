import { IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateChainNodeDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  @IsIn(['VLESS_REALITY', 'VLESS_WS_TLS', 'VLESS_TCP_TLS', 'HYSTERIA2', 'VMESS_TCP'])
  preset: string;

  @ApiProperty({ description: 'Entry server ID (user connects here)' })
  @IsString()
  entryServerId: string;

  @ApiProperty({ description: 'Exit server ID (traffic exits here)' })
  @IsString()
  exitServerId: string;
}
