// Latin runs inside RTL text (09 §5): times like "5:15 AM" must not reorder in Urdu. `<Bdi>` does it for JSX; text
// that goes into an ICU message ("Today: {time}", "Isha jamaat: {from} → {to}") gets the same isolation with the
// Unicode LEFT-TO-RIGHT ISOLATE … POP DIRECTIONAL ISOLATE pair.
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);

/** `text` isolated as a left-to-right run. */
export const ltr = (text: string): string => `${LRI}${text}${PDI}`;
