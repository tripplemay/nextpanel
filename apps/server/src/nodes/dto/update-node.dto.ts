import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CreateNodeDto } from './create-node.dto';

export class UpdateNodeDto extends PartialType(CreateNodeDto) {
  @ApiPropertyOptional({ enum: ['packet-up', 'stream-up'] })
  @IsOptional()
  @IsIn(['packet-up', 'stream-up'])
  xhttpMode?: 'packet-up' | 'stream-up';
}
