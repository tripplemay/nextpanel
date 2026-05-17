import { OpenRouterService } from './openrouter.service';
import { OpenRouterSettingsService } from './openrouter-settings.service';
import { BadRequestException } from '@nestjs/common';

// Mock the global fetch
const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

const mockSettings = {
  getDecrypted: jest.fn(),
} as unknown as OpenRouterSettingsService;

describe('OpenRouterService — baseURL composition', () => {
  let service: OpenRouterService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OpenRouterService(mockSettings);
  });

  it('listModels() calls {baseURL}/models', async () => {
    (mockSettings.getDecrypted as jest.Mock).mockResolvedValue({
      apiKey: 'sk-x',
      baseURL: 'https://api.minimax.chat/v1',
      model: 'MiniMax-Text-01',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await service.listModels();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimax.chat/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-x' }),
      }),
    );
  });

  it('testConnection() calls {baseURL}/chat/completions', async () => {
    (mockSettings.getDecrypted as jest.Mock).mockResolvedValue({
      apiKey: 'sk-deep',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
    fetchMock.mockResolvedValue({ ok: true });

    await service.testConnection();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('extractFromUrl() calls {baseURL}/chat/completions for AI extraction', async () => {
    (mockSettings.getDecrypted as jest.Mock).mockResolvedValue({
      apiKey: 'sk-or',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-sonnet-4',
    });

    // First fetch is the URL fetch (HTML)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html>price: $5/mo</html>',
    });
    // Second fetch is the AI call
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"name":"Test","price":"$5/mo","regions":["US"]}',
            },
          },
        ],
      }),
    });

    await service.extractFromUrl('https://example.com');

    // Find the OpenAI-format chat completions call
    const aiCall = fetchMock.mock.calls.find(([url]) =>
      typeof url === 'string' && url.endsWith('/chat/completions'),
    );
    expect(aiCall).toBeDefined();
    expect(aiCall![0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('throws if not configured', async () => {
    (mockSettings.getDecrypted as jest.Mock).mockResolvedValue(null);
    await expect(service.listModels()).rejects.toThrow(BadRequestException);
  });
});
