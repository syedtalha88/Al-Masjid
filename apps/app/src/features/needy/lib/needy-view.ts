// A23 "Help the needy" view helpers (07 A23, 00 §4.14, PHASE_05 T5.8): the zakat filter, the progress of one person,
// and the UPI link that pays them directly (CLAUDE.md §2.2 — the app never handles money). Pure.
import { buildUpiUri } from '@mc/domain/upi';
import type { Beneficiary } from '@mc/shared/contracts/public';

/** The listed people as the screen shows them: all, or only those the masjid marked zakat-eligible — server order. */
export const peopleToShow = (people: readonly Beneficiary[], zakatOnly: boolean): Beneficiary[] =>
  zakatOnly ? people.filter((person) => person.zakatEligible) : [...people];

/** The bar's fill (0–1, capped) and what the person still needs in paise (never negative). */
export function needyProgress(person: Beneficiary): { fraction: number; remainingPaise: number } {
  const { receivedPaise, capPaise } = person;
  return {
    fraction: capPaise > 0 ? Math.min(Math.max(receivedPaise / capPaise, 0), 1) : 0,
    remainingPaise: Math.max(capPaise - receivedPaise, 0),
  };
}

/**
 * The `upi://pay` link to the person's own UPI account — no amount (the giver types it in their UPI app); the masjid's
 * name is the payment note, so the person sees where the help came from.
 *
 * @returns `null` when the details cannot make a valid link (no link rather than a wrong one).
 */
export function needyLink(person: Pick<Beneficiary, 'vpa' | 'payeeName'>, masjidName: string): string | null {
  try {
    return buildUpiUri({ vpa: person.vpa, payeeName: person.payeeName, note: masjidName });
  } catch {
    return null;
  }
}
