import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('health probes', () => {
  const query = jest.fn();
  const controller = new HealthController({ $queryRaw: query } as unknown as PrismaService);
  it('separates process liveness from database readiness', async () => {
    query.mockRejectedValue(new Error('secret connection string'));
    expect(controller.live()).toEqual({ status: 'ok' });
    await expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);
    await expect(controller.ready()).rejects.toThrow('Database not ready');
    query.mockResolvedValue([{ '?column?': 1 }]);
    await expect(controller.ready()).resolves.toEqual({ status: 'ok' });
  });
  it('fails readiness on a stalled database', async () => {
    jest.useFakeTimers();
    query.mockReturnValue(new Promise(() => {}));
    const assertion = expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(2000);
    await assertion;
    jest.useRealTimers();
  });
});
