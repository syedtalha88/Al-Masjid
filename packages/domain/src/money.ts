// Money (CLAUDE.md §6, 09 §4): integer paise everywhere, never floats; ≤ 10^12 paise; displayed as "₹" + Indian
// grouping ("₹1,00,000") with Latin digits and no decimals unless the paise are non-zero. Pure string arithmetic, so
// every frame of a count-up animation keeps the grouping (08 §5.7) and no locale data is needed.

/** Largest amount the system accepts (10^12 paise = ₹1,000 crore) — matches the database validators. */
export const MAX_PAISE = 1_000_000_000_000;

/** Is `value` a valid amount in paise (a safe integer 0 … {@link MAX_PAISE})? */
export function isValidPaise(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PAISE;
}

/**
 * Indian digit grouping: the last three digits, then groups of two ("1,23,45,678").
 *
 * @throws RangeError for a negative, fractional or unsafe number.
 */
export function formatIndianGrouping(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('formatIndianGrouping(): expected a safe integer ≥ 0');
  }
  const digits = String(value);
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  return `${head.replace(/\B(?=(\d{2})+$)/g, ',')},${digits.slice(-3)}`;
}

/**
 * Paise → "₹72,000" or "₹72,000.50".
 *
 * @throws RangeError for an invalid amount (see {@link isValidPaise}).
 */
export function formatRupees(paise: number): string {
  if (!isValidPaise(paise)) throw new RangeError('formatRupees(): invalid paise');
  const rupees = formatIndianGrouping(Math.floor(paise / 100));
  const rest = paise % 100;
  return rest === 0 ? `₹${rupees}` : `₹${rupees}.${String(rest).padStart(2, '0')}`;
}

// Optional ₹, then either well-grouped digits (Indian or plain) and/or up to two decimals.
const RUPEES = /^₹?\s*((?:\d{1,2},(?:\d{2},)*\d{3})|\d+|(?=\.))(?:\.(\d{1,2}))?$/;

/**
 * Amount typed by an admin ("72000", "1,00,000", "₹72,000.5") → paise.
 *
 * @returns paise, or `null` for anything that is not unambiguously an amount (negative, more than two decimals,
 *   exponent, wrong grouping, non-Latin digits, above {@link MAX_PAISE}).
 */
export function parseRupees(text: string): number | null {
  const match = RUPEES.exec(text.trim());
  if (!match) return null;
  // Group 1 always takes part (possibly empty before a lone decimal part).
  const whole = String(match[1]).replaceAll(',', '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const paise = Number(whole || '0') * 100 + Number(fraction);
  return isValidPaise(paise) ? paise : null;
}

/**
 * Whole percentage of `part` in `total` (rounded down; may exceed 100 — the progress bar caps its fill, the text
 * shows the real value — 00 §4.3). A zero total is 0 %.
 */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.floor((part * 100) / total) : 0;
}
