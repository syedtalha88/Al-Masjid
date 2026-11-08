// Raising admin alerts from the API (01 §5.8 `alert-send`, PHASE_04 T4.6): the API only enqueues — the worker, the
// only process with the VAPID private key, sends. An alert names a fixed type and its recipients, never free text;
// `key` makes it unique (the BullMQ job id), so raising the same alert twice sends it once.
import type { createLogger } from '../logger.ts';
import type { JobInput } from './jobs.ts';
import type { JobQueues } from './queues.ts';

type Logger = ReturnType<typeof createLogger>;
type AlertJob = JobInput<'alert-send'>;

export interface AlertService {
  /**
   * Enqueues one alert. Never throws: an alert that cannot be enqueued is logged (the event itself is in the audit
   * log and on the Super Admin dashboard).
   *
   * @param key - what makes this alert unique (`[A-Za-z0-9_.-]`, e.g. a credential id) — the same key sends once.
   * @returns whether it was enqueued.
   */
  raise(input: {
    readonly type: AlertJob['alert']['type'];
    readonly to: AlertJob['to'];
    readonly key: string;
  }): Promise<boolean>;
}

/** The alert service over the job queues; `null` queues (unit tests) make it a no-op. */
export function alertService(queues: JobQueues | null, logger: Logger): AlertService {
  return {
    async raise({ type, to, key }) {
      if (queues === null) return false;
      const alertId = `${type}.${key}`.slice(0, 120);
      try {
        await queues.enqueue('alert-send', { alertId, to, alert: { type, params: {} } }, { jobId: `alert.${alertId}` });
        return true;
      } catch (error) {
        logger.error({ err: error, type }, 'alert not enqueued');
        return false;
      }
    },
  };
}
