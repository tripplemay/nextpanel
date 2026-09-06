import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportExternalNodesDto {
  @ApiProperty({ description: 'Raw URI(s), MiyaIP host:port:user:pass, or Base64 subscription content' })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiProperty({ required: false, enum: ['HTTP', 'SOCKS5'], default: 'HTTP', description: 'Protocol for MiyaIP entries without a scheme' })
  @IsOptional()
  @IsIn(['HTTP', 'SOCKS5'])
  protocol?: 'HTTP' | 'SOCKS5';
}
