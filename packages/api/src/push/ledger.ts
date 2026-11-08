// Send idempotency in Redis (01 §5.3 step 3, §5.8): per notification job, the devices already sent to
// (`push:sent:<jobId>`) — a retried batch, a duplicated fan-out or a stalled job re-run never pushes to a device twice
// — and the batches already counted (`push:done:<jobId>`), so a batch's result reaches the job's counters once. Both
// sets expire after a day (a job is long finished by then). Keys are under the worker's ACL pattern `~push:*`.
import type { Redis } from 'ioredis';

/** How long a job's ledger is kept. */
export const LEDGER_TTL_S = 24 * 60 * 60;

export interface SendLedger {
  /** Which of `deviceIds` were already sent `jobId`'s push. */
  sentAlready(jobId: string, deviceIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Records sends (after the push service accepted them). */
  markSent(jobId: string, deviceIds: readonly string[]): Promise<void>;
  /** `true` exactly once per (job, batch): the caller then records the batch's result. */
  claimBatch(jobId: string, batchId: string): Promise<boolean>;
  /** Undoes a claim whose result could not be recorded, so the batch's retry records it (DECISIONS #140). */
  releaseBatch(jobId: string, batchId: string): Promise<void>;
}

/**
 * The ledger over `redis`.
 *
 * @param prefix - key prefix (`push:`); tests use a client whose ioredis `keyPrefix` isolates them.
 */
export function redisSendLedger(redis: Redis, prefix = 'push:'): SendLedger {
  const sentKey = (jobId: string) => `${prefix}sent:${jobId}`;
  const doneKey = (jobId: string) => `${prefix}done:${jobId}`;
  return {
    async sentAlready(jobId, deviceIds) {
      if (deviceIds.length === 0) return new Set();
      const flags = await redis.smismember(sentKey(jobId), ...deviceIds);
      return new Set(deviceIds.filter((_, index) => flags[index] === 1));
    },
    async markSent(jobId, deviceIds) {
      if (deviceIds.length === 0) return;
      await redis
        .multi()
        .sadd(sentKey(jobId), ...deviceIds)
        .expire(sentKey(jobId), LEDGER_TTL_S)
        .exec();
    },
    async claimBatch(jobId, batchId) {
      const added = await redis.sadd(doneKey(jobId), batchId);
      await redis.expire(doneKey(jobId), LEDGER_TTL_S);
      return added === 1;
    },
    async releaseBatch(jobId, batchId) {
      await redis.srem(doneKey(jobId), batchId);
    },
  };
}
