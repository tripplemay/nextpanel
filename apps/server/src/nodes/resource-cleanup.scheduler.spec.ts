import { ResourceCleanupScheduler } from './resource-cleanup.scheduler';
import { CleanupBlockedError } from '../resources/resource-lifecycle.service';

jest.mock('../common/database/advisory-lock', () => ({ withPostgresAdvisoryLocks: jest.fn(async (_keys, work) => work()) }));

describe('durable cleanup scheduler', () => {
  const due = (id: string, state = 'PENDING') => ({ id, nodeId: id, serverId: 'host', state, attempts: 0, nextAttemptAt: new Date(0) });
  let jobs: ReturnType<typeof due>[];
  const prisma = {
    resourceCleanup: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    node: { findUnique: jest.fn() },
  };
  const resources = { finishRetiredServers: jest.fn() };
  const deploy = { cleanupDetachedResource: jest.fn() };
  const scheduler = () => new ResourceCleanupScheduler(prisma as any, resources as any, deploy as any);
  beforeEach(() => {
    jest.clearAllMocks();
    jobs = [due('entry'), due('exit'), due('dns')];
    prisma.resourceCleanup.findMany.mockImplementation(async () => jobs);
    prisma.resourceCleanup.findUnique.mockImplementation(async ({ where }) => jobs.find(j => j.id === where.id));
    prisma.resourceCleanup.update.mockImplementation(async ({ where, data }) => {
      const job = jobs.find(j => j.id === where.id)!;
      Object.assign(job, data, { attempts: typeof data.attempts === 'object' ? job.attempts + 1 : job.attempts });
      return job;
    });
    prisma.node.findUnique.mockResolvedValue(null);
    deploy.cleanupDetachedResource.mockResolvedValue(undefined);
    resources.finishRetiredServers.mockResolvedValue(undefined);
  });

  it('retries an unreachable entry without skipping exit and DNS cleanup', async () => {
    deploy.cleanupDetachedResource.mockImplementation(async job => { if (job.id === 'entry') throw new Error('SSH unavailable'); });
    await scheduler().tick();
    expect(jobs.map(j => j.state)).toEqual(['PENDING', 'DONE', 'DONE']);
    expect(jobs[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(resources.finishRetiredServers).toHaveBeenCalled();
  });

  it('a fresh worker resumes a persisted expired RUNNING lease', async () => {
    jobs = [due('crashed', 'RUNNING')];
    await scheduler().tick();
    expect(jobs[0].state).toBe('DONE');
    expect(deploy.cleanupDetachedResource).toHaveBeenCalledTimes(1);
  });

  it('does not steal a live lease or execute completed tasks from a stale candidate list', async () => {
    jobs = [{ ...due('live', 'RUNNING'), nextAttemptAt: new Date(Date.now() + 60000) }, due('finished', 'DONE')];
    await scheduler().tick();
    expect(deploy.cleanupDetachedResource).not.toHaveBeenCalled();
  });

  it('blocks a node restored into desired state before making any remote changes', async () => {
    jobs = [due('restored')];
    prisma.node.findUnique.mockResolvedValue({ id: 'restored' });
    await scheduler().tick();
    expect(jobs[0].state).toBe('BLOCKED');
    expect(deploy.cleanupDetachedResource).not.toHaveBeenCalled();
  });

  it('blocks ownership mismatches instead of retrying destructive work on a timer', async () => {
    jobs = [due('foreign')];
    deploy.cleanupDetachedResource.mockRejectedValue(new CleanupBlockedError('Different panel'));
    await scheduler().tick();
    expect(jobs[0].state).toBe('BLOCKED');
  });

  it('can pause all automatic destructive work without erasing pending intent', async () => {
    const previous = process.env.RESOURCE_CLEANUP_ENABLED;
    process.env.RESOURCE_CLEANUP_ENABLED = 'false';
    try {
      await scheduler().tick();
      expect(prisma.resourceCleanup.findMany).not.toHaveBeenCalled();
      expect(resources.finishRetiredServers).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.RESOURCE_CLEANUP_ENABLED;
      else process.env.RESOURCE_CLEANUP_ENABLED = previous;
    }
  });
});
