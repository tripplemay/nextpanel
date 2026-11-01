import { NotFoundException } from '@nestjs/common';
import { CloudflareSettingsService } from './cloudflare-settings.service';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CloudflareService } from './cloudflare.service';
import { CfOriginApi } from './cf-origin-api';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  cloudflareSetting: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
} as unknown as PrismaService;

const mockCrypto = {
  encrypt: jest.fn((s: string) => Promise.resolve(`enc:${s}`)),
  decrypt: jest.fn((s: string) => Promise.resolve(s.replace('enc:', ''))),
} as unknown as CryptoService;

const mockCfService = {
  verifyZoneAccess: jest.fn(),
} as unknown as CloudflareService;

const fakeSetting = {
  id: 'cf-1',
  userId: 'user-1',
  apiTokenEnc: 'enc:my-token',
  domain: 'example.com',
  zoneId: 'zone-abc',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CloudflareSettingsService', () => {
  let svc: CloudflareSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(CfOriginApi.prototype, 'preflight').mockResolvedValue();
    svc = new CloudflareSettingsService(mockPrisma, mockCrypto, mockCfService);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── upsert ──────────────────────────────────────────────────────────────────

  describe('upsert', () => {
    it('encrypts the API token and calls prisma.upsert', async () => {
      const returnValue = { id: 'cf-1', domain: 'example.com', zoneId: 'zone-abc', createdAt: new Date(), updatedAt: new Date() };
      (mockPrisma.cloudflareSetting.upsert as jest.Mock).mockResolvedValue(returnValue);

      const result = await svc.upsert('user-1', { apiToken: 'my-token', domain: 'example.com', zoneId: 'zone-abc' });

      expect(mockCrypto.encrypt).toHaveBeenCalledWith('my-token');
      expect(mockPrisma.cloudflareSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({ userId: 'user-1', apiTokenEnc: 'enc:my-token', domain: 'example.com', zoneId: 'zone-abc' }),
          update: expect.objectContaining({ apiTokenEnc: 'enc:my-token', domain: 'example.com', zoneId: 'zone-abc' }),
        }),
      );
      expect(result).toBe(returnValue);
    });
  });

  // ── findByUser ───────────────────────────────────────────────────────────────

  describe('findByUser', () => {
    it('returns setting when found', async () => {
      const partial = { id: 'cf-1', domain: 'example.com', zoneId: 'zone-abc', createdAt: new Date(), updatedAt: new Date() };
      (mockPrisma.cloudflareSetting.findUnique as jest.Mock).mockResolvedValue(partial);

      const result = await svc.findByUser('user-1');

      expect(result).toBe(partial);
    });

    it('returns null when not found', async () => {
      (mockPrisma.cloudflareSetting.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await svc.findByUser('user-1');

      expect(result).toBeNull();
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes the setting when it exists', async () => {
      (mockPrisma.cloudflareSetting.findUnique as jest.Mock).mockResolvedValue(fakeSetting);
      (mockPrisma.cloudflareSetting.delete as jest.Mock).mockResolvedValue(fakeSetting);

      await expect(svc.remove('user-1')).resolves.toBeUndefined();
      expect(mockPrisma.cloudflareSetting.delete).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    });

    it('throws NotFoundException when setting does not exist', async () => {
      (mockPrisma.cloudflareSetting.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.remove('user-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.cloudflareSetting.delete).not.toHaveBeenCalled();
    });
  });

  // ── verify ───────────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('returns valid=false with message when no credentials configured', async () => {
      (mockPrisma.cloudflareSetting.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await svc.verify('user-1');

      expect(result.valid).toBe(false);
      expect(result.message).toContain('未配置');
      expect(mockCfService.verifyZoneAccess).not.toHaveBeenCalled();
    });

    it('delegates to cfService.verifyZoneAccess with decrypted token', async () => {
      (mockPrisma.cloudflareSetting.findUnique as jest.Mock).mockResolvedValue(fakeSetting);
      (mockCfService.verifyZoneAccess as jest.Mock).mockResolvedValue({ valid: true, message: 'OK' });

      const result = await svc.verify('user-1');

      expect(mockCrypto.decrypt).toHaveBeenCalledWith('enc:my-token');
      expect(mockCfService.verifyZoneAccess).toHaveBeenCalledWith('my-token', 'zone-abc');
      expect(result.valid).toBe(true);
    });
  });

  // ── getDecryptedToken ────────────────────────────────────────────────────────

  describe('getDecryptedToken', () => {
    it('returns null when no setting exists', async () => {
      (mockPrisma.cloudflareSetting.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await svc.getDecryptedToken('user-1');

      expect(result).toBeNull();
    });

    it('returns decrypted token with domain and zoneId', async () => {
      (mockPrisma.cloudflareSetting.findUnique as jest.Mock).mockResolvedValue(fakeSetting);

      const result = await svc.getDecryptedToken('user-1');

      expect(mockCrypto.decrypt).toHaveBeenCalledWith('enc:my-token');
      expect(result).toEqual({ apiToken: 'my-token', domain: 'example.com', zoneId: 'zone-abc' });
    });
  });
});

describe('Cloudflare capability verification', () => {
  afterEach(() => jest.restoreAllMocks());
  const fixture = () => {
    const service = new CloudflareSettingsService({} as any, {} as any,
      { verifyZoneAccess: jest.fn().mockResolvedValue({ valid: true, zoneStatus: 'active', message: 'DNS access verified' }) } as any);
    jest.spyOn(service, 'getDecryptedToken').mockResolvedValue({ apiToken: 'fixture', zoneId: 'zone', domain: 'example.com' });
    return service;
  };
  it('does not mislabel DNS access as full XHTTP readiness', async () => {
    jest.spyOn(CfOriginApi.prototype, 'preflight').mockRejectedValue(new Error('Zone Settings Read: HTTP 403'));
    const result = await fixture().verify('owner');
    expect(result.valid).toBe(true);
    expect(result.origin).toEqual({ readable: false, message: 'Zone Settings Read: HTTP 403' });
  });
  it('explicitly distinguishes read-only checks from write and end-to-end acceptance', async () => {
    jest.spyOn(CfOriginApi.prototype, 'preflight').mockResolvedValue();
    const result = await fixture().verify('owner');
    expect(result.origin?.readable).toBe(true);
    expect(result.origin?.message).toContain('只读');
    expect(result.origin?.message).toContain('端到端');
  });
});
