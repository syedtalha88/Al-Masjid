// My zakat (07 A24, PHASE_05 T5.9): reads and changes the tracker in the device document. Nothing here talks to a
// server — the document is the only place the numbers exist (00 §4.15).
import { toHijri } from '@mc/domain/hijri';
import { calendarDateInZone } from '@mc/domain/time';
import { useTranslation } from '@mc/i18n/react';
import { useMemo } from 'react';

import { useAppData, useDeviceSelector } from '../../../lib/data.tsx';
import type { Zakat } from '../../../lib/device/store.ts';
import { type NewZakatPayment, withoutPayment, withOwed, withPayment, zakatSummary } from '../lib/zakat.ts';

/** `saved`, or `refused` when the helpers would not take it (500 entries, an amount out of range). */
export type ZakatChange = 'saved' | 'refused';

/**
 * The tracker, its summary and its changes. Needs the `settings` namespace (the year label's wording).
 * Changes resolve once the document is stored.
 */
export function useZakat() {
  const { t } = useTranslation('settings');
  const { store } = useAppData();
  const zakat = useDeviceSelector((state) => state.zakat);
  const summary = useMemo(() => zakatSummary(zakat), [zakat]);
  // The label a new tracker starts with: this Hijri year, e.g. "1448 AH" — the person can change it.
  const year = toHijri(calendarDateInZone(new Date()))?.year;
  const defaultLabel = year === undefined ? '' : t('zakat.yearLabel', { year: String(year) });

  const change = async (apply: (current: Zakat | undefined) => Zakat | null): Promise<ZakatChange> => {
    let result: ZakatChange = 'refused';
    await store.update((state) => {
      const next = apply(state.zakat);
      if (!next) return state;
      result = 'saved';
      return { ...state, zakat: next };
    });
    return result;
  };

  return {
    zakat,
    summary,
    defaultLabel,
    setOwed: (label: string, owedPaise: number) => change((current) => withOwed(current, label, owedPaise)),
    addPayment: (payment: NewZakatPayment) => change((current) => withPayment(current, payment, defaultLabel)),
    removePayment: (index: number) => change((current) => (current ? withoutPayment(current, index) : null)),
    /** Start again (a new year): the tracker is removed from the phone. */
    reset: async () => {
      await store.update((state) => {
        const { zakat: _removed, ...rest } = state;
        return rest;
      });
    },
  };
}
