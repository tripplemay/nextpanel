import { OpenRouterSettingsService } from './openrouter-settings.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

const mockPrisma = {
  openRouterSetting: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
} as unknown as PrismaService;

const mockCrypto = {
  encrypt: jest.fn((s: string) => `enc(${s})`),
  decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
} as unknown as CryptoService;

describe('OpenRouterSettingsService', () => {
  let service: OpenRouterSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OpenRouterSettingsService(mockPrisma, mockCrypto);
  });

  describe('get()', () => {
    it('returns baseURL alongside other public fields', async () => {
      (mockPrisma.openRouterSetting.findFirst as jest.Mock).mockResolvedValue({
        id: 'cfg1',
        apiKeyEnc: 'enc(secret)',
        baseURL: 'https://api.minimax.chat/v1',
        model: 'MiniMax-Text-01',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      });

      const result = await service.get();

      expect(result).toEqual({
        id: 'cfg1',
        baseURL: 'https://api.minimax.chat/v1',
        model: 'MiniMax-Text-01',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      });
      expect(result).not.toHaveProperty('apiKeyEnc');
    });

    it('returns null when no row exists', async () => {
      (mockPrisma.openRouterSetting.findFirst as jest.Mock).mockResolvedValue(null);
      expect(await service.get()).toBeNull();
    });
  });

  describe('getDecrypted()', () => {
    it('returns decrypted apiKey, baseURL, and model', async () => {
      (mockPrisma.openRouterSetting.findFirst as jest.Mock).mockResolvedValue({
        id: 'cfg1',
        apiKeyEnc: 'enc(sk-test)',
        baseURL: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });

      const result = await service.getDecrypted();

      expect(result).toEqual({
        apiKey: 'sk-test',
        baseURL: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });
    });
  });

  describe('upsert()', () => {
    it('creates new row with baseURL when none exists', async () => {
      (mockPrisma.openRouterSetting.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.openRouterSetting.create as jest.Mock).mockImplementation(({ data }) => ({
        id: 'new1',
        ...data,
      }));

      await service.upsert({
        apiKey: 'sk-new',
        baseURL: 'https://api.minimax.chat/v1',
        model: 'MiniMax-Text-01',
      });

      expect(mockPrisma.openRouterSetting.create).toHaveBeenCalledWith({
        data: {
          apiKeyEnc: 'enc(sk-new)',
          baseURL: 'https://api.minimax.chat/v1',
          model: 'MiniMax-Text-01',
        },
        select: { id: true, baseURL: true, model: true, createdAt: true, updatedAt: true },
      });
    });

    it('updates existing row preserving baseURL when not provided', async () => {
      (mockPrisma.openRouterSetting.findFirst as jest.Mock).mockResolvedValue({
        id: 'cfg1',
        apiKeyEnc: 'enc(old)',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'anthropic/claude-sonnet-4',
      });

      await service.upsert({ apiKey: 'sk-rotated' });

      expect(mockPrisma.openRouterSetting.update).toHaveBeenCalledWith({
        where: { id: 'cfg1' },
        data: {
          apiKeyEnc: 'enc(sk-rotated)',
          baseURL: 'https://openrouter.ai/api/v1', // preserved
          model: 'anthropic/claude-sonnet-4', // preserved
        },
        select: { id: true, baseURL: true, model: true, createdAt: true, updatedAt: true },
      });
    });

    it('uses default baseURL when creating with only apiKey', async () => {
      (mockPrisma.openRouterSetting.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.openRouterSetting.create as jest.Mock).mockResolvedValue({});

      await service.upsert({ apiKey: 'sk-bare' });

      expect(mockPrisma.openRouterSetting.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            baseURL: 'https://openrouter.ai/api/v1',
          }),
        }),
      );
    });
  });
});
