import { BadRequestException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { SystemInfoService } from './system-info.service';
import { SystemInfoDto, systemInfoKeys } from './system-info.dto';
import { PrismaService } from '../prisma.service';

describe('System information inventory', () => {
  const tx = {
    $queryRaw: jest.fn(),
    serverSystemInfo: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const prisma = { $transaction: (work: (value: typeof tx) => unknown) => work(tx) } as unknown as PrismaService;
  const service = new SystemInfoService(prisma);
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const payload = (): SystemInfoDto => ({
    agentToken: 'fixture', agentVersion: '1.9.0', schemaVersion: 1,
    collectedAt: new Date().toISOString(), values: { cpuModel: 'Test CPU', cpuLogicalCores: 2, architecture: 'arm64' },
  });
  const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: SystemInfoDto });

  beforeEach(() => {
    jest.resetAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: 'server', status: 'ONLINE', retiredAt: null }]);
    tx.serverSystemInfo.findUnique.mockResolvedValue(null);
  });

  it('accepts partial and empty inventories', async () => {
    await expect(validate(payload())).resolves.toBeInstanceOf(SystemInfoDto);
    await expect(validate({ ...payload(), values: {} })).resolves.toBeInstanceOf(SystemInfoDto);
  });

  it.each([
    { serverId: 'foreign' }, { schemaVersion: 2 }, { values: undefined }, { values: null }, { values: [] },
    { values: { cpuLogicalCores: 0 } }, { values: { cpuLogicalCores: 1.5 } },
    { values: { memoryTotalBytes: -1 } }, { values: { rootTotalBytes: Number.MAX_SAFE_INTEGER + 1 } },
    { values: { cpuModel: 'x'.repeat(257) } }, { values: { architecture: 'bad' } },
    { values: { secret: 'not-allowed' } }, { collectedAt: 'not-a-date' },
  ])('rejects malformed or extra input %j', async (override) => {
    await expect(validate({ ...payload(), ...override })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('selects identity only from the token and does not mutate heartbeat state', async () => {
    await expect(service.receive(payload())).resolves.toEqual({ ok: true });
    expect(tx.$queryRaw.mock.calls[0][1]).toBe('fixture');
    expect(tx.serverSystemInfo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { serverId: 'server' },
      create: expect.objectContaining({ serverId: 'server', schemaVersion: 1 }),
    }));
  });

  it('rejects unknown tokens without writing', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(service.receive(payload())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.serverSystemInfo.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'DELETING' }, { status: 'ERROR' }, { status: 'ONLINE', retiredAt: new Date() },
  ])('ignores inactive servers %j', async (state) => {
    tx.$queryRaw.mockResolvedValue([{ id: 'server', ...state }]);
    await expect(service.receive(payload())).resolves.toMatchObject({ ignored: true });
    expect(tx.serverSystemInfo.upsert).not.toHaveBeenCalled();
  });

  it('keeps failed field values with original timestamps, not a misleading refresh', async () => {
    const oldTime = new Date(Date.now() - 3600000);
    const oldMemory = { value: 4294967296, collectedAt: oldTime.toISOString() };
    tx.serverSystemInfo.findUnique.mockResolvedValue({ collectedAt: oldTime, fields: { memoryTotalBytes: oldMemory } });
    const current = payload();
    await service.receive(current);
    const data = tx.serverSystemInfo.upsert.mock.calls[0][0].update;
    expect(data.fields.memoryTotalBytes).toEqual(oldMemory);
    expect(data.fields.cpuModel).toEqual({ value: 'Test CPU', collectedAt: current.collectedAt });
    expect(data.missingFields).toContain('memoryTotalBytes');
  });

  it('records complete collection failure without clearing previous values', async () => {
    const current = payload();
    current.values = {};
    await service.receive(current);
    expect(tx.serverSystemInfo.upsert.mock.calls[0][0].update.missingFields).toEqual([...systemInfoKeys]);
  });

  it('does not refresh receipt time on replay or out-of-order delivery', async () => {
    const current = payload();
    tx.serverSystemInfo.findUnique.mockResolvedValue({ collectedAt: new Date(current.collectedAt), fields: {} });
    await expect(service.receive(current)).resolves.toMatchObject({ ignored: true });
    expect(tx.serverSystemInfo.upsert).not.toHaveBeenCalled();
  });

  it.each([-600000, 90000000])('rejects clock skew or very old delivery (%d ms)', async (age) => {
    await expect(service.receive({ ...payload(), collectedAt: new Date(Date.now() - age).toISOString() }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
