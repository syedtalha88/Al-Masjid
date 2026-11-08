// The line under "Notify followers" in every publish bar (07 B4–B7, PHASE_04 T4.5 / T4.7): how many people the post
// will reach and how many notifications are left today — or, while the Super Admin paused notifications, that they
// follow later (the post itself goes out now).
import { useTranslation } from '@mc/i18n/react';
import type { PushQuota } from '@mc/shared/contracts';

/**
 * @param audience - the post's audience (notices, hadith, dua requests and timing updates go to everyone).
 * @returns `undefined` while the quota loads.
 */
export function useNotifyLine(
  quota: PushQuota | undefined,
  audience: 'everyone' | 'brothers' | 'sisters' = 'everyone',
): string | undefined {
  const { t } = useTranslation('admin');
  if (!quota) return undefined;
  if (quota.paused) return t('push.paused');
  return t('push.reach', {
    count: quota.reach[audience],
    left: Math.max(quota.limit - quota.used, 0),
    limit: quota.limit,
  });
}
