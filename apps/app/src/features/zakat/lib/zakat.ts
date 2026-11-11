// My zakat (00 §4.15, 07 A24, PHASE_05 T5.9): the arithmetic of the phone-only tracker — what the person entered as
// owed, the payments they logged, what remains. Integer paise only (CLAUDE.md §6). The app does not calculate zakat:
// every number here was typed by the person. Pure; the document lives in the device store and is never sent.
import { isValidPaise, MAX_PAISE } from '@mc/domain/money';

import {
  MAX_ZAKAT_LABEL,
  MAX_ZAKAT_NOTE,
  MAX_ZAKAT_PAYMENTS,
  type Zakat,
  type ZakatPayment,
} from '../../../lib/device/store.ts';

export interface ZakatSummary {
  readonly owedPaise: number;
  /** Sum of the logged payments. */
  readonly paidPaise: number;
  /** Owed − paid, never below zero (someone who gave more than they entered sees ₹0). */
  readonly remainingPaise: number;
  /** Paid ÷ owed for the bar, 0–1 (0 while nothing is owed). */
  readonly fraction: number;
  /** The most a new payment may be, so the total stays a displayable amount. */
  readonly roomPaise: number;
  /** No further payment fits (500 entries). */
  readonly full: boolean;
}

/** What the screen shows for a tracker (or for none yet: all zero). */
export function zakatSummary(zakat: Zakat | undefined): ZakatSummary {
  const owedPaise = zakat?.owedPaise ?? 0;
  const paidPaise = (zakat?.payments ?? []).reduce((sum, payment) => sum + payment.amountPaise, 0);
  return {
    owedPaise,
    paidPaise,
    remainingPaise: Math.max(owedPaise - paidPaise, 0),
    fraction: owedPaise > 0 ? Math.min(paidPaise / owedPaise, 1) : 0,
    roomPaise: Math.max(MAX_PAISE - paidPaise, 0),
    full: (zakat?.payments.length ?? 0) >= MAX_ZAKAT_PAYMENTS,
  };
}

const clean = (text: string, max: number) => text.trim().slice(0, max).trim();

/**
 * The tracker with a new amount owed and year label (trimmed, ≤ 20 characters); the payments stay.
 *
 * @returns `null` for an amount that is not valid paise.
 */
export function withOwed(zakat: Zakat | undefined, label: string, owedPaise: number): Zakat | null {
  if (!isValidPaise(owedPaise)) return null;
  return { label: clean(label, MAX_ZAKAT_LABEL), owedPaise, payments: zakat?.payments ?? [] };
}

export interface NewZakatPayment {
  readonly at: Date;
  readonly amountPaise: number;
  /** Trimmed, ≤ 60 characters; empty = none. */
  readonly note?: string;
  /** The needy person (A23) this went to. */
  readonly beneficiaryPublicId?: string;
}

/**
 * The tracker with one more payment at the end. A tracker that does not exist yet starts with nothing owed and
 * `defaultLabel`.
 *
 * @returns `null` when the payment cannot be logged: 500 entries already, an amount that is not whole paise ≥ 1, or
 *   one that would take the total past the largest displayable amount.
 */
export function withPayment(zakat: Zakat | undefined, payment: NewZakatPayment, defaultLabel: string): Zakat | null {
  const { roomPaise, full } = zakatSummary(zakat);
  const { amountPaise } = payment;
  if (full || !isValidPaise(amountPaise) || amountPaise < 1 || amountPaise > roomPaise) return null;
  const note = clean(payment.note ?? '', MAX_ZAKAT_NOTE);
  const entry: ZakatPayment = {
    at: payment.at.toISOString(),
    amountPaise,
    ...(note === '' ? {} : { note }),
    ...(payment.beneficiaryPublicId === undefined ? {} : { beneficiaryPublicId: payment.beneficiaryPublicId }),
  };
  const base = zakat ?? { label: clean(defaultLabel, MAX_ZAKAT_LABEL), owedPaise: 0, payments: [] };
  return { ...base, payments: [...base.payments, entry] };
}

/** The tracker without the payment at `index` (its place in the stored, oldest-first list). */
export function withoutPayment(zakat: Zakat, index: number): Zakat {
  return { ...zakat, payments: zakat.payments.filter((_, at) => at !== index) };
}

/** The payments as the list shows them: newest first, each with its stored index (for removing it). */
export function paymentsNewestFirst(zakat: Zakat | undefined): { index: number; payment: ZakatPayment }[] {
  return (zakat?.payments ?? []).map((payment, index) => ({ index, payment })).reverse();
}
