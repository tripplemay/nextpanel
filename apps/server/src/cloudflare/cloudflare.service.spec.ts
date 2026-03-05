import { BadRequestException } from '@nestjs/common';
import { CloudflareService } from './cloudflare.service';

const svc = new CloudflareService();

// Silence logger
beforeEach(() => {
  jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

function mockFetch(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('CloudflareService', () => {
  describe('createARecord', () => {
    it('returns record ID on success', async () => {
      mockFetch({ success: true, errors: [], result: { id: 'rec-123', name: 'sub.example.com', content: '1.2.3.4' } });

      const id = await svc.createARecord('token', 'zone-1', 'sub.example.com', '1.2.3.4');

      expect(id).toBe('rec-123');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('zone-1/dns_records'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws BadRequestException when Cloudflare returns success=false', async () => {
      mockFetch({ success: false, errors: [{ message: 'Invalid zone' }], result: null });

      await expect(svc.createARecord('token', 'zone-1', 'sub.example.com', '1.2.3.4'))
        .rejects.toThrow(BadRequestException);
    });

    it('includes Authorization header with Bearer token', async () => {
      mockFetch({ success: true, errors: [], result: { id: 'rec-1', name: 'x', content: '1.1.1.1' } });

      await svc.createARecord('my-token', 'zone-1', 'x', '1.1.1.1');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
        }),
      );
    });
  });

  describe('deleteRecord', () => {
    it('resolves without error on success', async () => {
      mockFetch({ success: true, errors: [] });

      await expect(svc.deleteRecord('token', 'zone-1', 'rec-1')).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('rec-1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('resolves without error when record is already gone (404)', async () => {
      mockFetch({}, 404);

      await expect(svc.deleteRecord('token', 'zone-1', 'rec-1')).resolves.toBeUndefined();
    });

    it('throws BadRequestException when Cloudflare returns success=false', async () => {
      mockFetch({ success: false, errors: [{ message: 'Record not found' }] });

      await expect(svc.deleteRecord('token', 'zone-1', 'rec-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyZoneAccess', () => {
    it('returns valid=true with zone name and status on success', async () => {
      mockFetch({ success: true, errors: [], result: { name: 'example.com', status: 'active' } });

      const result = await svc.verifyZoneAccess('token', 'zone-1');

      expect(result.valid).toBe(true);
      expect(result.zoneName).toBe('example.com');
      expect(result.zoneStatus).toBe('active');
      expect(result.message).toContain('example.com');
    });

    it('returns valid=false with error message when Cloudflare rejects', async () => {
      mockFetch({ success: false, errors: [{ message: 'Unauthorized', code: 10000 }] });

      const result = await svc.verifyZoneAccess('bad-token', 'zone-1');

      expect(result.valid).toBe(false);
      expect(result.message).toContain('Unauthorized');
    });

    it('returns valid=false when fetch throws (network error)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network failure'));

      const result = await svc.verifyZoneAccess('token', 'zone-1');

      expect(result.valid).toBe(false);
      expect(result.message).toContain('Network failure');
    });
  });
});
