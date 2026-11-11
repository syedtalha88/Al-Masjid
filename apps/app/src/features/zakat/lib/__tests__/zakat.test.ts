// My zakat arithmetic (PHASE_05 T5.9 acceptance): the remaining amount is never shown negative, every amount is whole
// paise, 500 entries at most — and the device document accepts exactly what these helpers produce.
import { MAX_PAISE } from '@mc/domain/money';
import { describe, expect, it } from 'vitest';

import {
  createDeviceStore,
  initialDeviceState,
  MAX_ZAKAT_PAYMENTS,
  memoryBackend,
  migrateDeviceState,
  type Zakat,
} from '../../../../lib/device/store.ts';
import { paymentsNewestFirst, withoutPayment, withOwed, withPayment, zakatSummary } from '../zakat.ts';

const AT = new Date('2026-11-12T06:30:00.000Z');
const LABEL = '1448 AH';
const pay = (zakat: Zakat | undefined, amountPaise: number, note?: string) =>
  withPayment(zakat, { at: AT, amountPaise, ...(note === undefined ? {} : { note }) }, LABEL);

describe('zakatSummary', () => {
  it('nothing yet: all zero', () => {
    expect(zakatSummary(undefined)).toEqual({
      owedPaise: 0,
      paidPaise: 0,
      remainingPaise: 0,
      fraction: 0,
      roomPaise: MAX_PAISE,
      full: false,
    });
  });

  it('owed − paid, with the bar at paid ÷ owed', () => {
    const zakat = pay(pay(withOwed(undefined, LABEL, 500_000) ?? undefined, 120_000) ?? undefined, 30_050);
    expect(zakatSummary(zakat ?? undefined)).toMatchObject({
      owedPaise: 500_000,
      paidPaise: 150_050,
      remainingPaise: 349_950,
      fraction: 150_050 / 500_000,
    });
  });

  it('never shows a negative remaining amount: paying more than owed leaves ₹0 and a full bar', () => {
    const zakat = pay(withOwed(undefined, LABEL, 100_000) ?? undefined, 250_000);
    expect(zakatSummary(zakat ?? undefined)).toMatchObject({ remainingPaise: 0, fraction: 1, paidPaise: 250_000 });
    // Payments logged before any amount owed was entered: nothing remains, the bar stays empty.
    expect(zakatSummary(pay(undefined, 5000) ?? undefined)).toMatchObject({ remainingPaise: 0, fraction: 0 });
  });
});

describe('withOwed', () => {
  it('sets the amount and a trimmed label of at most 20 characters; the payments stay', () => {
    const paid = pay(undefined, 5000);
    const zakat = withOwed(paid ?? undefined, `  ${'y'.repeat(30)}  `, 700_000);
    expect(zakat).toEqual({ label: 'y'.repeat(20), owedPaise: 700_000, payments: paid?.payments });
  });

  it('refuses anything that is not whole paise in range', () => {
    for (const bad of [-1, 10.5, Number.NaN, MAX_PAISE + 1, Number.POSITIVE_INFINITY]) {
      expect(withOwed(undefined, LABEL, bad)).toBeNull();
    }
  });
});

describe('withPayment', () => {
  it('starts a tracker with the default label and nothing owed; appends oldest first', () => {
    const first = pay(undefined, 100, '  Test note  ');
    expect(first).toEqual({
      label: LABEL,
      owedPaise: 0,
      payments: [{ at: AT.toISOString(), amountPaise: 100, note: 'Test note' }],
    });
    const second = withPayment(
      first ?? undefined,
      { at: new Date('2026-11-13T00:00:00.000Z'), amountPaise: 200, note: '   ', beneficiaryPublicId: 'abcdefghjkmn' },
      'ignored',
    );
    expect(second?.label).toBe(LABEL);
    expect(second?.payments[1]).toEqual({
      at: '2026-11-13T00:00:00.000Z',
      amountPaise: 200,
      beneficiaryPublicId: 'abcdefghjkmn',
    });
  });

  it('keeps a note to 60 characters', () => {
    expect(pay(undefined, 100, 'n'.repeat(80))?.payments[0]?.note).toBe('n'.repeat(60));
  });

  it('paise are integers ≥ 1: fractions, zero and negatives are refused', () => {
    for (const bad of [0, -100, 99.5, Number.NaN, MAX_PAISE + 1]) expect(pay(undefined, bad)).toBeNull();
  });

  it('stops at 500 entries', () => {
    let zakat: Zakat | undefined;
    for (let count = 0; count < MAX_ZAKAT_PAYMENTS; count += 1) zakat = pay(zakat, 100) ?? undefined;
    expect(zakat?.payments).toHaveLength(MAX_ZAKAT_PAYMENTS);
    expect(zakatSummary(zakat).full).toBe(true);
    expect(pay(zakat, 100)).toBeNull();
  });

  it('the total never passes the largest displayable amount', () => {
    const zakat = pay(undefined, MAX_PAISE - 100) ?? undefined;
    expect(zakatSummary(zakat).roomPaise).toBe(100);
    expect(pay(zakat, 101)).toBeNull();
    expect(zakatSummary(pay(zakat, 100) ?? undefined).roomPaise).toBe(0);
  });
});

describe('the list', () => {
  it('shows newest first and removes by the stored index', () => {
    const zakat = pay(pay(pay(undefined, 100) ?? undefined, 200) ?? undefined, 300);
    if (!zakat) throw new Error('expected a tracker');
    expect(paymentsNewestFirst(zakat).map(({ index, payment }) => [index, payment.amountPaise])).toEqual([
      [2, 300],
      [1, 200],
      [0, 100],
    ]);
    expect(withoutPayment(zakat, 1).payments.map((payment) => payment.amountPaise)).toEqual([100, 300]);
    expect(paymentsNewestFirst(undefined)).toEqual([]);
  });
});

describe('the device document (04 §11: validated, never trusted)', () => {
  it('stores what the helpers produce and clears it with "Clear all data"', async () => {
    const backend = memoryBackend();
    const store = createDeviceStore(backend, 'en');
    const zakat = pay(withOwed(undefined, LABEL, 500_000) ?? undefined, 120_000, 'Test N.');
    await store.update((state) => ({ ...state, ...(zakat ? { zakat } : {}) }));
    expect(migrateDeviceState(await backend.get('device'), 'en')).toMatchObject({ reset: false, state: { zakat } });
    await store.clear();
    expect(store.current().zakat).toBeUndefined();
    expect(await backend.get('device')).toBeUndefined();
  });

  it('refuses a tampered tracker: fractional paise, 501 entries, an over-long label, a total past the limit', () => {
    const base = initialDeviceState('en');
    const entry = { at: AT.toISOString(), amountPaise: 100 };
    const tampered: unknown[] = [
      { label: LABEL, owedPaise: 10.5, payments: [] },
      { label: LABEL, owedPaise: -1, payments: [] },
      { label: 'x'.repeat(21), owedPaise: 0, payments: [] },
      { label: LABEL, owedPaise: 0, payments: [{ ...entry, amountPaise: 0 }] },
      { label: LABEL, owedPaise: 0, payments: [{ ...entry, note: 'n'.repeat(61) }] },
      { label: LABEL, owedPaise: 0, payments: Array.from({ length: MAX_ZAKAT_PAYMENTS + 1 }, () => entry) },
      { label: LABEL, owedPaise: 0, payments: [{ ...entry, amountPaise: MAX_PAISE }, entry] },
    ];
    for (const zakat of tampered) expect(migrateDeviceState({ ...base, zakat }, 'en').reset).toBe(true);
  });
});
