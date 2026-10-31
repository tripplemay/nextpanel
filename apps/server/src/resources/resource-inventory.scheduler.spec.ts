import { ResourceInventoryScheduler } from './resource-inventory.scheduler';

describe('read-only inventory scheduler', () => {
  it('continues after an offline host, rotates bounded batches and resets its cursor', async () => {
    const prisma = { server: { findMany: jest.fn()
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, userId: 'owner' })))
      .mockResolvedValueOnce([{ id: 's5', userId: 'owner' }]).mockResolvedValueOnce([]) } };
    const resources = { scan: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined) };
    const scheduler = new ResourceInventoryScheduler(prisma as any, resources as any);
    await scheduler.tick();
    expect(resources.scan).toHaveBeenCalledTimes(5);
    await scheduler.tick();
    expect(prisma.server.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 5, where: { sshAuthEnc: { not: '' }, id: { gt: 's4' } } }));
    await scheduler.tick();
    expect(prisma.server.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({ where: { sshAuthEnc: { not: '' } } }));
  });
});
