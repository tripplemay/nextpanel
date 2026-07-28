import { withPostgresAdvisoryLocks } from './advisory-lock';

function fakeClient(queryImpl?: (sql: string, values?: unknown[]) => Promise<unknown>) {
  const errorListeners = new Set<(err: Error) => void>();
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(queryImpl ?? (async (sql: string) => ({
      rows: sql.includes('pg_advisory_unlock') ? [{ unlocked: true }] : [],
    }))),
    end: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((_event: string, listener: (err: Error) => void) => {
      errorListeners.add(listener);
    }),
    removeListener: jest.fn((_event: string, listener: (err: Error) => void) => {
      errorListeners.delete(listener);
    }),
    emitError: (err: Error) => {
      for (const listener of errorListeners) listener(err);
    },
  };
}

describe('withPostgresAdvisoryLocks', () => {
  it('deduplicates and sorts lock keys, then unlocks in reverse order', async () => {
    const client = fakeClient();
    const work = jest.fn().mockResolvedValue('done');

    await expect(withPostgresAdvisoryLocks(
      ['z-key', 'a-key', 'z-key'],
      work,
      { clientFactory: () => client as any },
    )).resolves.toBe('done');

    const lockKeys = client.query.mock.calls
      .filter(([sql]) => String(sql).includes('pg_advisory_lock('))
      .map(([, values]) => values?.[0]);
    const unlockKeys = client.query.mock.calls
      .filter(([sql]) => String(sql).includes('pg_advisory_unlock('))
      .map(([, values]) => values?.[0]);
    expect(lockKeys).toEqual(['a-key', 'z-key']);
    expect(unlockKeys).toEqual(['z-key', 'a-key']);
    expect(work).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('releases acquired locks when work fails', async () => {
    const client = fakeClient();

    await expect(withPostgresAdvisoryLocks(
      ['node-1'],
      async () => { throw new Error('work failed'); },
      { clientFactory: () => client as any },
    )).rejects.toThrow('work failed');

    expect(client.query.mock.calls.some(
      ([sql]) => String(sql).includes('pg_advisory_unlock('),
    )).toBe(true);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('releases the acquired prefix when a later lock cannot be acquired', async () => {
    let lockCount = 0;
    const client = fakeClient(async (sql: string) => {
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] };
      if (sql.includes('pg_advisory_lock(') && ++lockCount === 2) {
        throw new Error('lock timeout');
      }
      return { rows: [] };
    });
    const work = jest.fn();

    await expect(withPostgresAdvisoryLocks(
      ['a-key', 'b-key'],
      work,
      { clientFactory: () => client as any },
    )).rejects.toThrow('lock timeout');

    const unlockKeys = client.query.mock.calls
      .filter(([sql]) => String(sql).includes('pg_advisory_unlock('))
      .map(([, values]) => values?.[0]);
    expect(unlockKeys).toEqual(['a-key']);
    expect(work).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('reports an unlock verification failure after successful work', async () => {
    const client = fakeClient(async (sql: string) => ({
      rows: sql.includes('pg_advisory_unlock') ? [{ unlocked: false }] : [],
    }));

    await expect(withPostgresAdvisoryLocks(
      ['node-1'],
      async () => 'done',
      { clientFactory: () => client as any },
    )).rejects.toThrow('PostgreSQL advisory lock was not held: node-1');
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('captures a connection error and reports an unverified lock state', async () => {
    const client = fakeClient();

    await expect(withPostgresAdvisoryLocks(
      ['node-1'],
      async () => {
        client.emitError(new Error('socket closed'));
        return 'done';
      },
      { clientFactory: () => client as any },
    )).rejects.toMatchObject({
      message: 'PostgreSQL advisory lock connection was lost: socket closed',
      rollbackFailed: true,
    });

    expect(client.removeListener).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
