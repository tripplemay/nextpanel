import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { PipelinesService } from './pipelines.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';

@ApiTags('pipelines')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pipelines')
export class PipelinesController {
  constructor(private pipelinesService: PipelinesService) {}

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  @Audit('CREATE', 'pipeline')
  @ApiOperation({ summary: 'Create a deploy config' })
  create(@Body() dto: CreatePipelineDto) {
    return this.pipelinesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all deploy configs' })
  findAll() {
    return this.pipelinesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pipelinesService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  @Audit('UPDATE', 'pipeline')
  update(@Param('id') id: string, @Body() dto: UpdatePipelineDto) {
    return this.pipelinesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit('DELETE', 'pipeline')
  remove(@Param('id') id: string) {
    return this.pipelinesService.remove(id);
  }

  @Get(':id/github-config')
  @ApiOperation({ summary: 'Generate GitHub Actions workflow YAML + required secrets' })
  githubConfig(@Param('id') id: string) {
    return this.pipelinesService.generateGithubConfig(id);
  }
}
