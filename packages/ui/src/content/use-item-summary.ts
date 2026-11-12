// The money line of a donation or chanda item in mixed lists (Home recent updates, Updates — 07 A2, A13; PHASE_05
// T5.6): "₹72,000 raised of ₹1,00,000" under a campaign's title, "₹18,500 collected in the week of 6 Nov" for a weekly
// chanda entry (which has no words of its own). The sentences of A10 / A11, kept in the `common` namespace too
// (`summary.*`) because Home and Updates render before the `content` strings are loaded; the push uses them as well.
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import { useCallback } from 'react';

/**
 * @returns a function giving an item's money line in the reader's language — `undefined` for every other item type
 *   (and for a campaign / chanda item without its detail).
 */
export function useItemSummary(): (item: FeedItem) => string | undefined {
  const { t } = useTranslation();
  const { format } = useLocale();
  return useCallback(
    (item: FeedItem) => {
      if (item.type === 'campaign' && item.campaign) {
        return t('summary.raisedOf', {
          received: format.money(item.campaign.receivedPaise),
          target: format.money(item.campaign.targetPaise),
        });
      }
      if (item.type === 'chanda_update' && item.chanda) {
        return t('summary.collected', {
          amount: format.money(item.chanda.amountPaise),
          date: format.calendarDate(item.chanda.weekStart, 'medium'),
        });
      }
      return undefined;
    },
    [t, format],
  );
}
