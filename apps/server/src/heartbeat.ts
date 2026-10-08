/** Redis key the worker refreshes; the container healthcheck reads it (01 §5.9). In the worker's ACL (`bull:*`). */
export const WORKER_HEARTBEAT_KEY = 'bull:mc:heartbeat:worker';
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_TTL_SECONDS = 30;

/** The subset of a Redis client the heartbeat needs. */
export interface HeartbeatRedis {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

/**
 * Starts refreshing the worker heartbeat key every {@link HEARTBEAT_INTERVAL_MS} (TTL
 * {@link HEARTBEAT_TTL_SECONDS}), so a stuck or dead worker shows up as unhealthy within 30 s.
 *
 * @param now - injectable clock (tests).
 * @returns a stop function that clears the timer.
 */
export function startHeartbeat(
  redis: HeartbeatRedis,
  onError: (error: unknown) => void,
  now: () => Date = () => new Date(),
): () => void {
  const beat = () => {
    redis.set(WORKER_HEARTBEAT_KEY, now().toISOString(), 'EX', HEARTBEAT_TTL_SECONDS).catch(onError);
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  return () => {
    clearInterval(timer);
  };
}
