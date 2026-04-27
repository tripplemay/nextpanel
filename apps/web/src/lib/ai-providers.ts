/**
 * AI Provider presets for the OpenRouter (now generic) settings page.
 *
 * The DB column is still `baseURL` on `OpenRouterSetting`. This file
 * is purely a frontend helper to auto-fill the URL/model fields when
 * the user picks a known provider.
 *
 * To add a new provider: append a new object below. No backend change
 * needed as long as the provider speaks OpenAI-compatible /v1/chat/completions.
 */
export interface AIProviderPreset {
  /** Internal key, used as Select value. */
  id: string;
  /** Display label in the dropdown. */
  label: string;
  /** OpenAI-compatible base URL, e.g. https://api.minimax.chat/v1 */
  baseURL: string;
  /** Suggested default model name for this provider. */
  defaultModel: string;
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-sonnet-4',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    baseURL: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M2.7',
  },
  {
    id: 'moonshot',
    label: 'Kimi (Moonshot)',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
  },
  {
    id: 'custom',
    label: '自定义',
    baseURL: '',
    defaultModel: '',
  },
];

/** Find which preset matches a given baseURL (for restoring UI state from saved config). */
export function detectPreset(baseURL: string | undefined): AIProviderPreset {
  if (!baseURL) return AI_PROVIDER_PRESETS[0]; // OpenRouter default
  const found = AI_PROVIDER_PRESETS.find((p) => p.baseURL && p.baseURL === baseURL);
  return found ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1]; // 自定义
}
