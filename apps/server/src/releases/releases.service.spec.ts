import { ReleasesService } from './releases.service';
import { PrismaService } from '../prisma.service';
import { NotFoundException } from '@nestjs/common';

const mockPrisma = {
  release: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  releaseStep: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaService;

const svc = new ReleasesService(mockPrisma);

const fakeRelease = {
  id: 'rel-1', templateId: 'tpl-1', status: 'PENDING',
  steps: [{ id: 'step-1', serverId: 'srv-1', status: 'PENDING' }],
  createdById: 'user-1',
};

beforeEach(() => jest.clearAllMocks());

describe('ReleasesService', () => {
  describe('create', () => {
    it('creates release with steps for each target', async () => {
      // create returns release; executeRelease calls update/findMany/update
      (mockPrisma.release.create as jest.Mock).mockResolvedValue(fakeRelease);
      (mockPrisma.release.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.releaseStep.findMany as jest.Mock).mockResolvedValue(fakeRelease.steps);
      (mockPrisma.releaseStep.update as jest.Mock).mockResolvedValue({});

      const dto = {
        templateId: 'tpl-1',
        targets: ['srv-1', 'srv-2'],
        strategy: 'ROLLING' as any,
        variables: { port: '8080' },
      };

      const result = await svc.create(dto, 'user-1');

      expect(result).toBe(fakeRelease);
      expect(mockPrisma.release.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            templateId: 'tpl-1',
            createdById: 'user-1',
            variables: { port: '8080' },
          }),
        }),
      );
    });

    it('defaults variables to {} when not provided', async () => {
      (mockPrisma.release.create as jest.Mock).mockResolvedValue(fakeRelease);
      (mockPrisma.release.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.releaseStep.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.releaseStep.update as jest.Mock).mockResolvedValue({});

      await svc.create({ templateId: 't', targets: [], strategy: 'ROLLING' as any }, 'u');

      const data = (mockPrisma.release.create as jest.Mock).mock.calls[0][0].data;
      expect(data.variables).toEqual({});
    });

    it('creates one step per target server', async () => {
      (mockPrisma.release.create as jest.Mock).mockResolvedValue(fakeRelease);
      (mockPrisma.release.update as jest.Mock).mockResolvedValue({});
      (mockPrisma.releaseStep.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.releaseStep.update as jest.Mock).mockResolvedValue({});

      await svc.create({ templateId: 't', targets: ['s1', 's2', 's3'], strategy: 'ROLLING' as any }, 'u');

      const data = (mockPrisma.release.create as jest.Mock).mock.calls[0][0].data;
      expect(data.steps.create).toHaveLength(3);
      expect(data.steps.create[0]).toEqual({ serverId: 's1', status: 'PENDING' });
    });
  });

  describe('findAll', () => {
    it('returns all releases with related data', async () => {
      (mockPrisma.release.findMany as jest.Mock).mockResolvedValue([fakeRelease]);

      const result = await svc.findAll();

      expect(result).toHaveLength(1);
      const call = (mockPrisma.release.findMany as jest.Mock).mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(call.include.steps).toBe(true);
      expect(call.include.createdBy).toBeDefined();
      expect(call.include.template).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('returns release when found', async () => {
      (mockPrisma.release.findUnique as jest.Mock).mockResolvedValue(fakeRelease);

      await expect(svc.findOne('rel-1')).resolves.toBe(fakeRelease);
    });

    it('throws NotFoundException when release is missing', async () => {
      (mockPrisma.release.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.findOne('bad')).rejects.toThrow(NotFoundException);
    });
  });

  describe('executeRelease (error path via create)', () => {
    it('logs error when executeRelease throws (via mocked update failure)', async () => {
      (mockPrisma.release.create as jest.Mock).mockResolvedValue(fakeRelease);
      // First update (RUNNING) succeeds; releaseStep.findMany throws → triggers catch → updates FAILED
      (mockPrisma.release.update as jest.Mock)
        .mockResolvedValueOnce({})  // first update: status RUNNING
        .mockResolvedValueOnce({}); // second update: status FAILED (from catch)
      (mockPrisma.releaseStep.findMany as jest.Mock).mockRejectedValue(new Error('db error'));

      // Should not throw — error is caught internally
      await expect(svc.create({ templateId: 't', targets: ['s1'], strategy: 'ROLLING' as any }, 'u'))
        .resolves.toBe(fakeRelease);

      // Wait for the fire-and-forget promise to settle
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The catch branch should have called update with FAILED status
      const calls = (mockPrisma.release.update as jest.Mock).mock.calls;
      const failedCall = calls.find((c) => c[0]?.data?.status === 'FAILED');
      expect(failedCall).toBeDefined();
    });
  });

  describe('rollback', () => {
    it('marks release as ROLLED_BACK and returns message', async () => {
      (mockPrisma.release.findUnique as jest.Mock).mockResolvedValue(fakeRelease);
      (mockPrisma.release.update as jest.Mock).mockResolvedValue({});

      const result = await svc.rollback('rel-1');

      expect(result.message).toContain('rel-1');
      expect(mockPrisma.release.update).toHaveBeenCalledWith({
        where: { id: 'rel-1' },
        data: { status: 'ROLLED_BACK' },
      });
    });

    it('throws NotFoundException when release is missing', async () => {
      (mockPrisma.release.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(svc.rollback('bad')).rejects.toThrow(NotFoundException);
    });
  });
});
