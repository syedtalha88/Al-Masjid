// Document readers shared by the read repositories: documents come back untyped through the policy gateway, and the
// collections' validators define them. Results are JSON-ready (ids as canonical text, instants as ISO strings, absent
// rather than undefined-valued optional fields). A value the validator should have excluded fails loudly (drift).
import { type Document, Long, UUID } from 'mongodb';

import { fromInt64, idText } from '../values.ts';

/** A string field, or `undefined`. */
export const text = (doc: Document, key: string): string | undefined => {
  const value: unknown = doc[key];
  return typeof value === 'string' ? value : undefined;
};

/** A required string field. @throws Error when missing (schema drift). */
export const need = (doc: Document, key: string): string => {
  const value = text(doc, key);
  if (value === undefined) throw new Error(`document without ${key}`);
  return value;
};

/** An enum field (validators guarantee the value; drift fails loudly instead of leaking an unknown value). */
export const oneOf = <T extends string>(doc: Document, key: string, values: readonly T[]): T => {
  const value = need(doc, key);
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`document with unexpected ${key}`);
  return found;
};

/** An optional enum field. */
export const maybeOneOf = <T extends string>(doc: Document, key: string, values: readonly T[]): T | undefined =>
  text(doc, key) === undefined ? undefined : oneOf(doc, key, values);

/** A number field (int, double or int64), or `undefined`. */
export const numberOf = (doc: Document, key: string): number | undefined => {
  const value: unknown = doc[key];
  if (typeof value === 'number') return value;
  return value instanceof Long ? fromInt64(value) : undefined;
};

/** A Date field as an ISO string, or `undefined`. */
export const iso = (doc: Document, key: string): string | undefined => {
  const value: unknown = doc[key];
  return value instanceof Date ? value.toISOString() : undefined;
};

/** A UUID field as canonical text. @throws Error when it is not a UUID. */
export const idOf = (doc: Document, key = '_id'): string => {
  const value: unknown = doc[key];
  if (!(value instanceof UUID)) throw new Error(`document without UUID ${key}`);
  return idText(value);
};

/** A sub-document, or `undefined`. */
export const objectOf = (doc: Document, key: string): Document | undefined => {
  const value: unknown = doc[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
    ? value // a sub-document of a validated collection
    : undefined;
};

/** An array of sub-documents (empty when absent). */
export const arrayOf = (doc: Document, key: string): Document[] => {
  const value: unknown = doc[key];
  return Array.isArray(value) ? (value as Document[]) : []; // arrays of sub-documents per the validator
};

/** Keeps only defined properties (contracts use absent, never undefined-valued, optional fields). */
export const compact = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T; // same keys, fewer

/** One prayer's raw configuration (02 masjid_timings) in the contracts' shape. */
export const prayerOf = (doc: Document | undefined) => {
  const value = doc ?? {};
  return compact({
    adhanMode: text(value, 'adhan_mode') === 'manual' ? ('manual' as const) : ('auto' as const),
    adhanTime: text(value, 'adhan_time'),
    adhanAdjustMin: numberOf(value, 'adhan_adjust_min') ?? 0,
    jamaatMode: maybeOneOf(value, 'jamaat_mode', ['fixed', 'offset', 'none'] as const) ?? 'none',
    jamaatTime: text(value, 'jamaat_time'),
    jamaatOffsetMin: numberOf(value, 'jamaat_offset_min'),
  });
};

/**
 * A `masjid_timings` document as the raw schedule the clients resolve with `@mc/domain/prayer` (the musalli bundle and
 * the admin's today strip / editor read the same shape).
 */
export const timingsOf = (doc: Document) => {
  const prayers = objectOf(doc, 'prayers') ?? {};
  return {
    prayers: {
      fajr: prayerOf(objectOf(prayers, 'fajr')),
      dhuhr: prayerOf(objectOf(prayers, 'dhuhr')),
      asr: prayerOf(objectOf(prayers, 'asr')),
      maghrib: prayerOf(objectOf(prayers, 'maghrib')),
      isha: prayerOf(objectOf(prayers, 'isha')),
    },
    jumuah: arrayOf(doc, 'jumuah').map((slot) =>
      compact({
        seq: numberOf(slot, 'seq') ?? 1,
        khutbahTime: text(slot, 'khutbah_time'),
        jamaatTime: need(slot, 'jamaat_time'),
      }),
    ),
  };
};
