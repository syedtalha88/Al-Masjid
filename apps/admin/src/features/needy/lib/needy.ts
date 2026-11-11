// B19 needy people logic (07 B19, 00 §4.14, 05 §1, PHASE_05 T5.8): the add / edit draft and what is still missing, the
// save body (integer paise; UPI ID normalized; the private phone / note sent only when the admin typed or opened it),
// a scanned UPI QR filling the draft, the live percentage of "Update received", and what each person's card offers.
// Pure: the screens render, the hooks call the API, the server checks the same rules again.
import { percentOf } from '@mc/domain/money';
import { formatPhone } from '@mc/domain/phone';
import { cleanUpiText, isValidVpa, normalizeVpa, parseUpiUri } from '@mc/domain/upi';
import type { Locale } from '@mc/i18n/locales';
import {
  type AdminBeneficiary,
  BENEFICIARY_CAP_MAX_PAISE,
  BENEFICIARY_CAP_MIN_PAISE,
  BENEFICIARY_NAME_MAX,
  BENEFICIARY_NOTE_MAX,
  BENEFICIARY_REASON_MAX,
  type BeneficiaryPrivate,
  type BeneficiarySave,
  E164,
} from '@mc/shared/contracts';

import { phoneValue } from '../../notice/lib/notice.ts';

export type NeedyCategory = AdminBeneficiary['category'];
export type NeedyStatus = AdminBeneficiary['status'];

/** The payee name as the UPI apps show it (the same bound as the masjid's own UPI details). */
export const NEEDY_PAYEE_MAX = 100;

export interface NeedyDraft {
  /** First name or initials only (00 §4.14). */
  readonly name: string;
  readonly category: NeedyCategory | null;
  readonly reason: string;
  /** The language the saved reason was written in; `null` for a new person (the admin's language is used). */
  readonly reasonLocale: Locale | null;
  /** The saved reason — while unchanged, it keeps its language. */
  readonly savedReason: string | null;
  readonly vpa: string;
  readonly payee: string;
  readonly capPaise: number;
  readonly zakat: boolean;
  /** As typed ("98765 43210"); empty or the bare "+91" prefix = none. Private — only this masjid's admins see it. */
  readonly phone: string;
  /** Private note. */
  readonly note: string;
  /**
   * Whether the phone / note fields hold the stored private part (a new person, one without a private part, or after
   * "Show private details"). While `false` the save leaves the stored part alone.
   */
  readonly privateLoaded: boolean;
  /** "The person — or a guardian for a child — agreed to be listed with these details": ticked on every save. */
  readonly consent: boolean;
}

export type NeedyIssue = 'name' | 'category' | 'reason' | 'vpa' | 'payee' | 'cap' | 'phone' | 'consent';

/** A new person: +91 prefilled for the optional private phone, nothing else chosen. */
export const emptyDraft = (): NeedyDraft => ({
  name: '',
  category: null,
  reason: '',
  reasonLocale: null,
  savedReason: null,
  vpa: '',
  payee: '',
  capPaise: 0,
  zakat: false,
  phone: '+91 ',
  note: '',
  privateLoaded: true,
  consent: false,
});

/** A listed person as a draft. The consent tick starts empty: every save states it again (05 §1). */
export const draftOf = (person: AdminBeneficiary): NeedyDraft => ({
  name: person.displayName,
  category: person.category,
  reason: person.reason,
  reasonLocale: person.reasonLocale,
  savedReason: person.reason,
  vpa: person.vpa,
  payee: person.payeeName,
  capPaise: person.capPaise,
  zakat: person.zakatEligible,
  phone: '+91 ',
  note: '',
  privateLoaded: !person.hasPrivate,
  consent: false,
});

/** The draft after "Show private details": the stored phone / note in the fields, from now on saved as shown. */
export const withPrivate = (draft: NeedyDraft, stored: BeneficiaryPrivate | null): NeedyDraft => ({
  ...draft,
  phone: stored?.phone ? formatPhone(stored.phone) : '+91 ',
  note: stored?.note ?? '',
  privateLoaded: true,
});

/** The typed phone in E.164, or `null` when none was typed (empty, or only the prefilled country code). */
function phoneOf(draft: NeedyDraft): string | null {
  const value = phoneValue(draft.phone.trim());
  return value === '' || value === '+91' ? null : value;
}

/** What still keeps the person from being saved, in form order. */
export function needyIssues(draft: NeedyDraft): NeedyIssue[] {
  const issues: NeedyIssue[] = [];
  const name = draft.name.trim();
  if (name.length < 1 || name.length > BENEFICIARY_NAME_MAX) issues.push('name');
  if (draft.category === null) issues.push('category');
  const reason = draft.reason.trim();
  if (reason.length < 1 || reason.length > BENEFICIARY_REASON_MAX) issues.push('reason');
  if (!isValidVpa(normalizeVpa(draft.vpa))) issues.push('vpa');
  const payee = cleanUpiText(draft.payee);
  if (payee.length < 1 || payee.length > NEEDY_PAYEE_MAX) issues.push('payee');
  if (draft.capPaise < BENEFICIARY_CAP_MIN_PAISE || draft.capPaise > BENEFICIARY_CAP_MAX_PAISE) issues.push('cap');
  const phone = phoneOf(draft);
  if (draft.privateLoaded && phone !== null && !E164.test(phone)) issues.push('phone');
  if (!draft.consent) issues.push('consent');
  return issues;
}

/**
 * The body of `POST` / `PATCH …/beneficiaries`, or `null` while something is missing.
 *
 * @param locale - the admin's language: the language of a reason typed now.
 */
export function needyBody(draft: NeedyDraft, locale: Locale): BeneficiarySave | null {
  if (needyIssues(draft).length > 0 || draft.category === null) return null;
  const reason = draft.reason.trim();
  const phone = phoneOf(draft);
  const note = draft.note.trim().slice(0, BENEFICIARY_NOTE_MAX);
  const typed: BeneficiaryPrivate = { ...(phone === null ? {} : { phone }), ...(note === '' ? {} : { note }) };
  const hasTyped = phone !== null || note !== '';
  // A new person: only what was typed. A saved one: untouched unless opened; opened and emptied removes it.
  const isNew = draft.savedReason === null;
  const privatePart = !draft.privateLoaded ? {} : hasTyped ? { private: typed } : isNew ? {} : { private: null };
  return {
    displayName: draft.name.trim(),
    category: draft.category,
    reason,
    reasonLocale: draft.reasonLocale !== null && reason === draft.savedReason?.trim() ? draft.reasonLocale : locale,
    vpa: normalizeVpa(draft.vpa),
    payeeName: cleanUpiText(draft.payee),
    capPaise: draft.capPaise,
    zakatEligible: draft.zakat,
    consentConfirmed: true,
    ...privatePart,
  };
}

/**
 * A scanned QR into the draft: only a `upi://pay` QR with a valid UPI ID counts (04 §6); its payee name replaces the
 * typed one when the QR has one. The consent tick is cleared — the person agreed to specific details. `null` for
 * anything else (the screen says "not a UPI payment QR").
 */
export function draftFromScan(text: string, current: NeedyDraft): NeedyDraft | null {
  const scanned = parseUpiUri(text);
  if (!scanned) return null;
  return {
    ...current,
    vpa: scanned.vpa,
    payee: (scanned.payeeName ?? current.payee).slice(0, NEEDY_PAYEE_MAX),
    consent: false,
  };
}

/** Whole percent of the amount needed (may exceed 100 — the bar caps, the text shows the real value). */
export const needyPercent = (receivedPaise: number, capPaise: number): number => percentOf(receivedPaise, capPaise);

/** The people of one status chip, in the server's order (active: least-funded first). */
export const peopleWithStatus = (people: readonly AdminBeneficiary[], status: NeedyStatus): AdminBeneficiary[] =>
  people.filter((person) => person.status === status);

/**
 * What a person's card offers: an active person everything; a fulfilled one a corrected amount (below the cap lists
 * them again), close or remove — their details are not edited; a closed one nothing (final).
 */
export const needyActions = (person: AdminBeneficiary) => ({
  updateReceived: person.status !== 'closed',
  edit: person.status === 'active',
  end: person.status !== 'closed',
});
