// Value mappers between API values and BSON (02 §0): int64 money/counters, UUID ids.
import { Long, UUID } from 'mongodb';

import { MAX_PAISE } from './schema/dsl.ts';

export class ValueError extends Error {}

/**
 * Converts a JS number to BSON int64 (02 §0: money is integer paise, never a double).
 *
 * @param value - a safe integer in `[minimum, maximum]` (default 0 … 10^12).
 * @throws ValueError for non-integers, unsafe integers and values out of range.
 */
export function toInt64(value: number, minimum = 0, maximum = MAX_PAISE): Long {
  if (!Number.isSafeInteger(value)) throw new ValueError('not a safe integer');
  if (value < minimum || value > maximum) throw new ValueError('out of range');
  return Long.fromNumber(value);
}

/**
 * Reads an int64 (or a number the driver promoted) back as a JS number.
 *
 * @throws ValueError when the value does not fit a safe integer.
 */
export function fromInt64(value: Long | number): number {
  const number = typeof value === 'number' ? value : value.toNumber();
  if (!Number.isSafeInteger(number)) throw new ValueError('int64 does not fit a safe integer');
  return number;
}

/** A new random UUID v4 for an `_id` (DECISIONS #22). */
export const newId = (): UUID => new UUID();

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parses a UUID v4 from API input (route params etc.).
 *
 * @returns the UUID, or `undefined` when the text is not a canonical v4 UUID (callers answer 404, never 500).
 */
export function parseId(text: string): UUID | undefined {
  return UUID_TEXT.test(text) ? new UUID(text.toLowerCase()) : undefined;
}

const ANY_UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses an authenticator's AAGUID (any UUID version; authenticator models are not v4) for
 * `webauthn_credentials.aaguid`.
 *
 * @returns the UUID, or `undefined` for malformed text and for the all-zero AAGUID (`attestation: 'none'`), which
 *   identifies nothing and is not stored.
 */
export function parseAaguid(text: string): UUID | undefined {
  if (!ANY_UUID_TEXT.test(text) || /^[0-]+$/.test(text)) return undefined;
  return new UUID(text.toLowerCase());
}

/** Canonical lower-case text form for API responses. */
export const idText = (id: UUID): string => id.toHexString(true);

/** True for a UUID value read from the database (documents come back untyped through the gateway). */
export const isId = (value: unknown): value is UUID => value instanceof UUID;
