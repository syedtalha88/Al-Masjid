// Phone numbers a masjid publishes as contacts (template param `phone`, Ilm contacts — DECISIONS #104): stored and
// sent in E.164 ("+" then 7–15 ASCII digits, no leading zero), so a WhatsApp or call link can be built from them as is.

const E164 = /^\+[1-9][0-9]{6,14}$/;

/** Is `value` a phone number in E.164 form ("+910000000000")? Spaces, dashes and non-ASCII digits are refused. */
export function isE164(value: unknown): value is string {
  return typeof value === 'string' && E164.test(value);
}
