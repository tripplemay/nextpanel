import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { OpenRouterSettingsService } from './openrouter-settings.service';

export interface ExtractResult {
  name: string;
  price: string;
  regions: string[];
}

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);

  constructor(private readonly settings: OpenRouterSettingsService) {}

  /** Fetch available models from OpenRouter */
  async listModels(): Promise<{ id: string; name: string; promptPrice: string; completionPrice: string }[]> {
    const config = await this.settings.getDecrypted();
    if (!config) throw new BadRequestException('OpenRouter 未配置');

    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new BadRequestException(`获取模型列表失败：HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      data: { id: string; name: string; pricing: { prompt: string; completion: string } }[];
    };

    return (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      promptPrice: m.pricing?.prompt ?? '0',
      completionPrice: m.pricing?.completion ?? '0',
    }));
  }

  /** Test API key validity and model availability */
  async testConnection(model?: string): Promise<{ success: boolean; message: string }> {
    const config = await this.settings.getDecrypted();
    if (!config) throw new BadRequestException('OpenRouter 未配置');

    const targetModel = model ?? config.model;

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 401) return { success: false, message: 'API Key 无效' };
        if (res.status === 404) return { success: false, message: `模型 ${targetModel} 不可用` };
        return { success: false, message: `请求失败：HTTP ${res.status} ${body}` };
      }

      return { success: true, message: `连接成功，模型 ${targetModel} 可用` };
    } catch (err) {
      return { success: false, message: `连接失败：${err}` };
    }
  }

  async extractFromUrl(url: string): Promise<ExtractResult> {
    const config = await this.settings.getDecrypted();
    if (!config) throw new BadRequestException('OpenRouter 未配置');

    // Step 1: Fetch the URL HTML
    let html: string;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) {
        if (res.status === 403) {
          throw new BadRequestException('该网站有反爬保护（HTTP 403），无法自动识别，请手动填写');
        }
        throw new Error(`HTTP ${res.status}`);
      }
      html = await res.text();
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Failed to fetch URL ${url}: ${err}`);
      throw new BadRequestException(`无法访问该 URL: ${err}`);
    }

    // Step 2: Strip HTML to plain text
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Step 3: Truncate to 8000 chars
    if (text.length > 8000) {
      text = text.slice(0, 8000);
    }

    // Step 4: Call OpenRouter API
    const systemPrompt =
      '你是一个VPS服务商信息提取助手。从以下网页内容中提取：1.服务商名称 2.最低价格(含周期) 3.支持的地区/机房位置。返回JSON格式：{"name":"...","price":"...","regions":["..."]}';

    let responseText: string;
    try {
      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!apiRes.ok) {
        const errBody = await apiRes.text();
        this.logger.error(`OpenRouter API error: ${apiRes.status} ${errBody}`);
        throw new Error(`OpenRouter API HTTP ${apiRes.status}`);
      }

      const data = (await apiRes.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      responseText = data.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      this.logger.error(`OpenRouter API call failed: ${err}`);
      throw new BadRequestException(`AI 提取失败: ${err}`);
    }

    // Step 5: Parse JSON from response
    try {
      // Extract JSON from potential markdown code block
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        name: parsed.name ?? '',
        price: parsed.price ?? '',
        regions: Array.isArray(parsed.regions) ? parsed.regions : [],
      };
    } catch (err) {
      this.logger.error(`Failed to parse AI response: ${responseText}`);
      throw new BadRequestException('AI 返回格式无法解析');
    }
  }
}
