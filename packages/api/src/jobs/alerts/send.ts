// `alert-send` (01 §5.8, PHASE_04 T4.6): one admin / Super Admin alert to every subscribed phone of its recipients, in
// each admin's app language. The worker is the only process with the VAPID private key, so the APIs and other jobs only
// enqueue alerts; an alert is fixed words per type (never free text), opening a fixed admin app path. Gone subscriptions
// are deleted; a retryable answer retries the job (BullMQ backoff — at most a repeated alert, which `tag` collapses).
import { type DbHandle, parseId, systemScope } from '@mc/db';
import { type AlertTarget, getAlertTargets, recordAlertDelivery } from '@mc/db/state';
import { alertText } from '@mc/i18n/push-text';
import type { Clock } from '@mc/shared/clock';
import { type AdminAlertPayload, adminAlertPayloadSchema } from '@mc/shared/contracts/push';

import type { createLogger } from '../../logger.ts';
import type { PushSender } from '../../push/sender.ts';
import type { JobPayload } from '../../queue/jobs.ts';
import { PushRetryError } from '../push/send-batch.ts';

type Logger = ReturnType<typeof createLogger>;

/** Where each alert opens in the admin app. */
const ALERT_PATH: Readonly<Record<AdminAlertPayload['type'], string>> = {
  credential_counter_regression: '/account',
  super_passkey_added: '/account',
  push_job_stuck: '/super',
  test: '/',
  payment_request: '/super/payments',
  payment_request_owner: '/profile',
  payment_approved: '/payment',
  payment_rejected: '/payment',
  payment_active: '/payment',
  report_urgent: '/super/reports',
  report_autohide: '/super/reports',
  item_removed: '/posts',
  sla_50: '/super',
  sla_80: '/super',
  sla_100: '/super',
  retention_failed: '/super/audit',
};

/** Alerts live four hours at the push service and always arrive at once. */
const ALERT_TTL_S = 4 * 60 * 60;

export interface AlertDeps {
  readonly db: DbHandle;
  readonly sender: PushSender;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Sends one alert.
 *
 * @throws PushRetryError when some phones should be tried again (and it is not the last attempt).
 */
export async function processAlertSend(
  deps: AlertDeps,
  payload: JobPayload<'alert-send'>,
  attempt: { readonly final: boolean },
): Promise<{ readonly delivered: number; readonly pruned: number }> {
  const scope = systemScope();
  const to =
    payload.to.kind === 'super'
      ? ({ kind: 'super' } as const)
      : {
          kind: 'admins' as const,
          adminIds: payload.to.adminIds.flatMap((text) => {
            const id = parseId(text);
            return id ? [id] : [];
          }),
        };
  const targets = await getAlertTargets(deps.db, scope, to, deps.clock.now());
  const delivered: AlertTarget['id'][] = [];
  const gone: AlertTarget['id'][] = [];
  let retry = 0;
  for (const target of targets) {
    const words = alertText(payload.alert.type, target.locale);
    const message: AdminAlertPayload = adminAlertPayloadSchema.parse({
      v: 1,
      kind: 'alert',
      type: payload.alert.type,
      t: words.title,
      b: words.body,
      u: ALERT_PATH[payload.alert.type],
      tag: payload.alertId,
      l: target.locale,
    });
    const outcome = await deps.sender.send(target, JSON.stringify(message), { ttlS: ALERT_TTL_S, urgency: 'high' });
    if (outcome.kind === 'sent') delivered.push(target.id);
    else if (outcome.kind === 'gone') gone.push(target.id);
    else if (outcome.kind === 'retry') retry += 1;
  }
  await recordAlertDelivery(deps.db, scope, { delivered, gone }, deps.clock.now());
  deps.logger.info(
    { alertId: payload.alertId, type: payload.alert.type, phones: targets.length, delivered: delivered.length },
    'alert sent',
  );
  if (retry > 0 && delivered.length === 0 && !attempt.final) throw new PushRetryError(retry);
  return { delivered: delivered.length, pruned: gone.length };
}
