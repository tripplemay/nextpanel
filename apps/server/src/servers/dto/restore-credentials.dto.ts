import { IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RestoreCredentialsDto {
  @ApiProperty({ description: 'SSH password or private key' })
  @IsString()
  sshAuth: string;

  @ApiProperty({ description: 'SSH auth type', enum: ['PASSWORD', 'KEY'] })
  @IsString()
  @IsIn(['PASSWORD', 'KEY'])
  sshAuthType: 'PASSWORD' | 'KEY';
}
