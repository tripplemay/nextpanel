import { Client } from 'pg';

type LockClient = Pick<Client, 'connect' | 'query' | 'end' | 'on' | 'removeListener'>;

interface AdvisoryLockOptions {
  connectionString?: string;
  lockWaitMs?: number;
  clientFactory?: () => LockClient;
}

const DEFAULT_LOCK_WAIT_MS = 30_000;

export class AdvisoryLockLostError extends Error {
  readonly rollbackFailed = true;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AdvisoryLockLostError';
    this.cause = cause;
  }
}

/**
 * Hold sorted PostgreSQL session locks on one dedicated connection while work
 * uses the regular Prisma pool. Session end is the final fail-safe release.
 */
export async function withPostgresAdvisoryLocks<T>(
  keys: string[],
  work: () => Promise<T>,
  options: AdvisoryLockOptions = {},
): Promise<T> {
  const orderedKeys = [...new Set(keys)].sort();
  if (orderedKeys.length === 0) return work();

  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString && !options.clientFactory) {
    throw new Error('DATABASE_URL is required for advisory locks');
  }

  const client = options.clientFactory?.() ?? new Client({
    connectionString,
    application_name: 'nextpanel-advisory-lock',
    keepAlive: true,
  });
  const acquired: string[] = [];
  let connected = false;
  let primaryError: unknown;
  let cleanupError: unknown;
  const connectionErrors: Error[] = [];
  const onConnectionError = (err: Error) => {
    if (connectionErrors.length === 0) connectionErrors.push(err);
  };
  client.on('error', onConnectionError);

  try {
    await client.connect();
    connected = true;
    const waitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
    await client.query(
      "SELECT set_config('lock_timeout', $1, false)",
      [`${waitMs}ms`],
    );

    for (const key of orderedKeys) {
      await client.query(
        'SELECT pg_advisory_lock(hashtextextended($1::text, 0))',
        [key],
      );
      acquired.push(key);
    }
    return await work();
  } catch (err) {
    primaryError = err;
    throw err;
  } finally {
    if (connected) {
      for (const key of [...acquired].reverse()) {
        try {
          const result = await client.query<{ unlocked: boolean }>(
            'SELECT pg_advisory_unlock(hashtextextended($1::text, 0)) AS unlocked',
            [key],
          );
          if (result.rows[0]?.unlocked !== true) {
            throw new Error(`PostgreSQL advisory lock was not held: ${key}`);
          }
        } catch (err) {
          cleanupError ??= err;
        }
      }
    }

    try {
      await client.end();
    } catch (err) {
      cleanupError ??= err;
    }
    client.removeListener('error', onConnectionError);

    const connectionError = connectionErrors[0];
    if (connectionError) {
      throw new AdvisoryLockLostError(
        `PostgreSQL advisory lock connection was lost: ${connectionError.message}`,
        primaryError ?? cleanupError ?? connectionError,
      );
    }
    if (cleanupError && primaryError === undefined) throw cleanupError;
  }
}
