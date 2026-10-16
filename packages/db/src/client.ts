// One MongoClient per process (01 §5.1, PHASE_01 T1.5): lazy, module-scoped, the process's OWN user only, options
// from 01 §5.1 (pool sizes, majority concerns, timeouts, TLS outside local), health ping, graceful close; plus the
// transaction helper every multi-document write uses (02 §0).
import { type ClientSession, type Db, MongoClient, type MongoClientOptions } from 'mongodb';

import type { Scope } from './scope.ts';

export type DbProcess = 'api-public' | 'api-admin' | 'worker' | 'migrate' | 'script';

export interface DbConfig {
  /** The process's own connection string (MONGODB_URI_PUBLIC / _ADMIN / _SYSTEM / _MIGRATOR). Never logged. */
  readonly uri: string;
  readonly database: string;
  readonly process: DbProcess;
  /** `local` allows a plain-text connection to the Docker MongoDB; everything else requires TLS. */
  readonly local: boolean;
}

/** 01 §5.1 client options for a process. */
export function clientOptions(config: Pick<DbConfig, 'process' | 'local'>): MongoClientOptions {
  return {
    appName: config.process,
    maxPoolSize: config.process === 'worker' ? 30 : 20,
    minPoolSize: config.process === 'migrate' || config.process === 'script' ? 0 : 2,
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 5_000,
    retryWrites: true,
    retryReads: true,
    w: 'majority',
    readConcernLevel: 'majority',
    ...(config.local ? {} : { tls: true }),
  };
}

export interface DbHandle {
  /** The application database; connects on first use (concurrent callers share one connection attempt). */
  db(): Promise<Db>;
  /** Health: a `ping` round trip, never throws (01 §5.9 health endpoints, T1.6). */
  ping(): Promise<{ ok: boolean; latencyMs: number }>;
  /** Closes the pool (graceful shutdown); later `db()` calls reject. */
  close(): Promise<void>;
  /** The driver client, for transactions (`withTransaction`) only. */
  readonly client: MongoClient;
}

/**
 * Creates the process's database handle. Call once per process (module scope); tests create one per file.
 *
 * @throws synchronously for a URI that is not a MongoDB URI.
 */
export function createDbHandle(config: DbConfig): DbHandle {
  const client = new MongoClient(config.uri, clientOptions(config));
  let connecting: Promise<Db> | undefined;
  let closed = false;
  const db = (): Promise<Db> => {
    if (closed) return Promise.reject(new Error('database handle closed'));
    connecting ??= client.connect().then(
      (connected) => connected.db(config.database),
      (error: unknown) => {
        connecting = undefined; // a later request may retry (e.g. Atlas briefly unreachable at boot)
        throw error;
      },
    );
    return connecting;
  };
  return {
    client,
    db,
    async ping() {
      const started = performance.now();
      try {
        await (await db()).command({ ping: 1 });
        return { ok: true, latencyMs: Math.round(performance.now() - started) };
      } catch {
        return { ok: false, latencyMs: Math.round(performance.now() - started) };
      }
    },
    async close() {
      closed = true;
      await client.close();
    },
  };
}

export interface TxContext {
  readonly scope: Scope;
  readonly db: Db;
  readonly session: ClientSession;
}

/**
 * Runs `fn` in one MongoDB transaction (02 §0: every multi-document write): snapshot isolation via majority read
 * concern, majority write concern, primary reads. The driver retries the whole callback on
 * `TransientTransactionError` and the commit on `UnknownTransactionCommitResult` — so `fn` must be safe to re-run
 * (no side effects outside the database before commit).
 *
 * @returns what `fn` returned on the committed attempt.
 * @throws whatever `fn` throws (the transaction is aborted), or the driver's error after its retries run out.
 */
export async function withTransaction<T>(
  handle: DbHandle,
  scope: Scope,
  fn: (ctx: TxContext) => Promise<T>,
): Promise<T> {
  const db = await handle.db();
  const session = handle.client.startSession();
  try {
    return await session.withTransaction(async (txSession) => fn({ scope, db, session: txSession }), {
      readConcern: { level: 'majority' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
    });
  } finally {
    await session.endSession();
  }
}
