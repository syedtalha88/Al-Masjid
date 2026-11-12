// B8 "UPI setup / change" logic (07 B8, 04 R1, PHASE_05 T5.2): the form draft, what is still missing, the request body
// (VPA normalized, payee name cleaned — exactly what the Super Admin approves and every link will carry), a scanned UPI
// QR filling the draft, and the status line. Pure: the screen renders, the hooks call the API.
import { wallClockInZone } from '@mc/domain/time';
import { cleanUpiText, isValidVpa, normalizeVpa, parseUpiUri } from '@mc/domain/upi';
import type { Formatters } from '@mc/i18n/format';
import { ltrIsolate } from '@mc/i18n/template-args';
import type { PaymentRequest, PaymentRequestRow } from '@mc/shared/contracts';

export interface PaymentDraft {
  readonly vpa: string;
  readonly payee: string;
  readonly note: string;
}

export type PaymentIssue = 'vpa' | 'payee';

export const PAYEE_MAX = 100;
export const NOTE_MAX = 300;

export const emptyDraft = (): PaymentDraft => ({ vpa: '', payee: '', note: '' });

/** What still keeps the request from being sent, in form order. */
export function draftIssues(draft: PaymentDraft): PaymentIssue[] {
  const issues: PaymentIssue[] = [];
  if (!isValidVpa(normalizeVpa(draft.vpa))) issues.push('vpa');
  const payee = cleanUpiText(draft.payee);
  if (payee.length < 1 || payee.length > PAYEE_MAX) issues.push('payee');
  return issues;
}

/** The body of `POST /payment/requests`, or `null` while something is missing. */
export function requestBody(draft: PaymentDraft): PaymentRequest | null {
  if (draftIssues(draft).length > 0) return null;
  const note = draft.note.trim().slice(0, NOTE_MAX);
  return { vpa: normalizeVpa(draft.vpa), payeeName: cleanUpiText(draft.payee), ...(note === '' ? {} : { note }) };
}

/**
 * A scanned QR into the draft: only a `upi://pay` QR with a valid VPA counts (04 §6); its payee name replaces the typed
 * one when the QR has one. `null` for anything else (the screen says "not a UPI payment QR").
 */
export function draftFromScan(text: string, current: PaymentDraft): PaymentDraft | null {
  const scanned = parseUpiUri(text);
  if (!scanned) return null;
  return { ...current, vpa: scanned.vpa, payee: (scanned.payeeName ?? current.payee).slice(0, PAYEE_MAX) };
}

/** How far a request got: 1 requested, 2 approved (on hold), 3 live; a rejection stops at 1. */
export function stepsDone(request: PaymentRequestRow | null): number {
  if (!request) return 0;
  return request.status === 'approved_on_hold' ? 2 : 1;
}

/**
 * "Thu, 12 Nov, 4:30 PM" in IST — when approved details go live. The time is a left-to-right isolate: inside an Urdu
 * sentence it would otherwise read "PM 4:30" (F58, DECISIONS #136 — phase-verifier 12 Nov 2026).
 */
export function liveAtText(iso: string, format: Formatters): string {
  const at = new Date(iso);
  return `${format.date(at, 'weekday')}, ${ltrIsolate(format.time(wallClockInZone(at)).text)}`;
}
