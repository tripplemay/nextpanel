import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class UpdateRoleDto {
  @ApiProperty({ enum: ['OPERATOR', 'VIEWER'] })
  @IsEnum(['OPERATOR', 'VIEWER'])
  role: UserRole;
}
