import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';

interface RuleDef {
  url: string;
  /** Clash rule-provider behavior type */
  behavior: 'domain' | 'ipcidr' | 'classical';
}

export const RULE_DEFS: Record<string, RuleDef> = {
  // ── Loyalsoldier ──────────────────────────────────────────────────────────
  reject: {
    url: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/reject.txt',
    behavior: 'domain',
  },
  proxy: {
    url: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/proxy.txt',
    behavior: 'domain',
  },
  direct: {
    url: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/direct.txt',
    behavior: 'domain',
  },
  cncidr: {
    url: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/cncidr.txt',
    behavior: 'ipcidr',
  },
  telegramcidr: {
    url: 'https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/telegramcidr.txt',
    behavior: 'ipcidr',
  },
  // ── blackmatrix7 ──────────────────────────────────────────────────────────
  netflix: {
    url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Netflix/Netflix.yaml',
    behavior: 'classical',
  },
  youtube: {
    url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/YouTube/YouTube.yaml',
    behavior: 'classical',
  },
  apple: {
    url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Apple/Apple.yaml',
    behavior: 'classical',
  },
  microsoft: {
    url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Microsoft/Microsoft.yaml',
    behavior: 'classical',
  },
  openai: {
    url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/OpenAI/OpenAI.yaml',
    behavior: 'classical',
  },
};

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.refreshAll();
  }

  /** Refresh all rules every 24 hours */
  @Interval(24 * 60 * 60 * 1000)
  async refreshAll() {
    this.logger.log('Refreshing rule cache...');
    await Promise.allSettled(
      Object.keys(RULE_DEFS).map((name) => this.refreshOne(name)),
    );
    this.logger.log('Rule cache refresh complete');
  }

  private async refreshOne(name: string) {
    const def = RULE_DEFS[name];
    try {
      const res = await fetch(def.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = await res.text();
      await this.prisma.ruleCache.upsert({
        where: { name },
        create: { name, content },
        update: { content },
      });
      this.logger.debug(`Rule "${name}" updated (${content.length} bytes)`);
    } catch (err) {
      this.logger.warn(`Failed to refresh rule "${name}": ${(err as Error).message}`);
    }
  }

  async getContent(name: string): Promise<{ content: string; behavior: string }> {
    const def = RULE_DEFS[name];
    if (!def) throw new NotFoundException(`Unknown rule: ${name}`);

    const cached = await this.prisma.ruleCache.findUnique({ where: { name } });
    if (!cached) throw new NotFoundException(`Rule "${name}" not yet cached`);

    return { content: cached.content, behavior: def.behavior };
  }
}
