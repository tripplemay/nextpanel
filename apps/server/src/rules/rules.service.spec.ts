import { RulesService, RULE_DEFS } from './rules.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException } from '@nestjs/common';

// Prevent @Interval decorator from scheduling real timers
jest.mock('@nestjs/schedule', () => ({
  Interval: () => () => undefined,
}));

global.fetch = jest.fn();

const mockPrisma = {
  ruleCache: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
} as unknown as PrismaService;

const svc = new RulesService(mockPrisma);

beforeEach(() => {
  jest.clearAllMocks();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: jest.fn().mockResolvedValue('rule-content'),
  });
  (mockPrisma.ruleCache.upsert as jest.Mock).mockResolvedValue({});
});

describe('RulesService', () => {
  describe('getContent', () => {
    it('throws NotFoundException for unknown rule name', async () => {
      await expect(svc.getContent('unknown-rule')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when rule is not yet cached', async () => {
      (mockPrisma.ruleCache.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(svc.getContent('reject')).rejects.toThrow(NotFoundException);
    });

    it('returns content and behavior for a cached rule', async () => {
      (mockPrisma.ruleCache.findUnique as jest.Mock).mockResolvedValue({
        name: 'reject',
        content: 'some-rules',
      });

      const result = await svc.getContent('reject');
      expect(result.content).toBe('some-rules');
      expect(result.behavior).toBe(RULE_DEFS.reject.behavior);
    });
  });

  describe('refreshAll', () => {
    it('fetches all rule definitions and upserts them', async () => {
      await svc.refreshAll();

      expect(global.fetch).toHaveBeenCalledTimes(Object.keys(RULE_DEFS).length);
      expect(mockPrisma.ruleCache.upsert).toHaveBeenCalledTimes(Object.keys(RULE_DEFS).length);
    });

    it('continues refreshing other rules when one fetch fails', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue({ ok: true, text: jest.fn().mockResolvedValue('content') });

      await svc.refreshAll(); // should not throw

      // All but the first rule should succeed
      expect(mockPrisma.ruleCache.upsert).toHaveBeenCalledTimes(Object.keys(RULE_DEFS).length - 1);
    });

    it('handles non-ok HTTP responses gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });

      await svc.refreshAll(); // should not throw
      expect(mockPrisma.ruleCache.upsert).not.toHaveBeenCalled();
    });
  });
});
