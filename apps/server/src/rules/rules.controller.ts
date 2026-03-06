import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RulesService } from './rules.service';

@ApiTags('rules')
@Controller('rules')
export class RulesController {
  constructor(private rulesService: RulesService) {}

  /** Public — proxy-cached rule file for Clash rule-providers */
  @Get(':name')
  @ApiOperation({ summary: 'Get cached rule file by name' })
  async getRule(@Param('name') name: string, @Res() res: Response) {
    const { content } = await this.rulesService.getContent(name);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(content);
  }
}
