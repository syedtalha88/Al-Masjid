// Schema DSL (02 §0, PHASE_01 T1.2, DECISIONS #64): every field builder yields BOTH the Zod schema (what the data
// layer accepts/returns, as TypeScript sees it) and the MongoDB `$jsonSchema` fragment (what the database enforces).
// One definition per collection → TypeScript types, Zod parsing and the validator can never drift apart.
import { Binary, Long, ObjectId } from 'mongodb';
import { z } from 'zod';

/** A MongoDB `$jsonSchema` fragment (subset used here). */
export type BsonSchema = Readonly<Record<string, unknown>>;

export interface Field<T extends z.ZodType = z.ZodType> {
  readonly zod: T;
  readonly bson: BsonSchema;
  /** Absent allowed (02 §0 "absent vs null": optional fields are absent, never null). */
  readonly optional: boolean;
}

const field = <T extends z.ZodType>(zod: T, bson: BsonSchema): Field<T> => ({ zod, bson, optional: false });

/** Money ceiling (02 §0): ≤ 10^12 paise. */
export const MAX_PAISE = 1_000_000_000_000;

/** `YYYY-MM-DD` (IST calendar date) and `HH:mm` (24 h wall clock) — 02 §0. */
export const DATE_PATTERN = '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$';
export const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';

const isUuid = (value: unknown): value is Binary => value instanceof Binary && value.sub_type === Binary.SUBTYPE_UUID;

export const f = {
  /** BSON UUID (Binary subtype 4) — every `_id` and `<thing>_id` (DECISIONS #22). */
  uuid: () => field(z.custom<Binary>(isUuid, { error: 'must be a UUID' }), { bsonType: 'binData' }),

  /** Raw bytes (token hashes, credential ids, public keys); `length` = exact byte count when given. */
  bytes: (length?: number) =>
    field(
      z.custom<Binary>((value) => value instanceof Binary && (length === undefined || value.length() === length), {
        error: length === undefined ? 'must be binary' : `must be ${String(length)} bytes`,
      }),
      { bsonType: 'binData' },
    ),

  objectId: () => field(z.instanceof(ObjectId), { bsonType: 'objectId' }),

  /** Text with a hard maximum (02 §0: every string has maxLength). */
  string: (maxLength: number, options: { pattern?: string; minLength?: number } = {}) =>
    field(
      z
        .string()
        .max(maxLength)
        .min(options.minLength ?? 0)
        .regex(new RegExp(options.pattern ?? '[\\s\\S]*')),
      {
        bsonType: 'string',
        maxLength,
        ...(options.minLength === undefined ? {} : { minLength: options.minLength }),
        ...(options.pattern === undefined ? {} : { pattern: options.pattern }),
      },
    ),

  /** Calendar date string `YYYY-MM-DD`. */
  date: () => field(z.string().regex(new RegExp(DATE_PATTERN)), { bsonType: 'string', pattern: DATE_PATTERN }),

  /** Wall-clock time `HH:mm`. */
  time: () => field(z.string().regex(new RegExp(TIME_PATTERN)), { bsonType: 'string', pattern: TIME_PATTERN }),

  /** BSON Date (UTC instant). */
  instant: () => field(z.date(), { bsonType: 'date' }),

  bool: () => field(z.boolean(), { bsonType: 'bool' }),

  /** Small integer stored as BSON `int` (minutes, offsets, quotas, counts). */
  int: (minimum: number, maximum: number) =>
    field(z.number().int().min(minimum).max(maximum), { bsonType: 'int', minimum, maximum }),

  /**
   * 64-bit integer stored as BSON `long` (money in paise, versions, counters that may grow) — written through
   * `toInt64()`; a `double` or `int` is rejected by the validator (02 §0).
   */
  long: (minimum = 0, maximum = MAX_PAISE) =>
    field(z.number().int().min(minimum).max(maximum), {
      bsonType: 'long',
      minimum: Long.fromNumber(minimum),
      maximum: Long.fromNumber(maximum),
    }),

  /** A coordinate in degrees; ints accepted because whole degrees serialise as BSON int. */
  degrees: (minimum: number, maximum: number) =>
    field(z.number().min(minimum).max(maximum), { bsonType: ['double', 'int'], minimum, maximum }),

  enum: <const V extends readonly [string, ...string[]]>(values: V) =>
    field(z.enum(values), { bsonType: 'string', enum: [...values] }),

  /** Free-form object (template params, audit meta): shape checked by the data layer, size-capped there. */
  anyObject: () => field(z.record(z.string(), z.unknown()), { bsonType: 'object' }),

  array: <T extends z.ZodType>(item: Field<T>, options: { min?: number; max: number; unique?: boolean }) =>
    field(
      z
        .array(item.zod)
        .min(options.min ?? 0)
        .max(options.max),
      {
        bsonType: 'array',
        items: item.bson,
        maxItems: options.max,
        ...(options.min === undefined ? {} : { minItems: options.min }),
        ...(options.unique ? { uniqueItems: true } : {}),
      },
    ),

  object: <S extends Record<string, Field>>(shape: S) => {
    const required = Object.entries(shape)
      .filter(([, value]) => !value.optional)
      .map(([key]) => key);
    return field(z.strictObject(zodShape(shape)), {
      bsonType: 'object',
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
      properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.bson])),
    });
  },

  /** `{en?, hi?, ur?, te?}` (02 §0 i18n objects); `required` lists locales that must be present. */
  i18n: (maxLength: number, required: readonly ('en' | 'hi' | 'ur' | 'te')[] = []) =>
    f.object(
      Object.fromEntries(
        (['en', 'hi', 'ur', 'te'] as const).map((locale) => [
          locale,
          required.includes(locale) ? f.string(maxLength) : opt(f.string(maxLength)),
        ]),
      ),
    ),
};

/** Marks a field optional (absent allowed; null still rejected). */
export function opt<T extends z.ZodType>(value: Field<T>): Field<z.ZodOptional<T>> {
  return { zod: value.zod.optional(), bson: value.bson, optional: true };
}

type ZodShape<S extends Record<string, Field>> = { [K in keyof S]: S[K]['zod'] };

function zodShape<S extends Record<string, Field>>(shape: S): ZodShape<S> {
  return Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.zod])) as ZodShape<S>; // shape is mapped key-for-key above
}

/** Builds a document's top-level `$jsonSchema` from its shape plus optional cross-field rules (`oneOf`/`allOf`). */
export function documentSchema<S extends Record<string, Field>>(
  shape: S,
  rules: { oneOf?: readonly BsonSchema[]; allOf?: readonly BsonSchema[] } = {},
): { zod: z.ZodObject<ZodShape<S>, z.core.$strict>; jsonSchema: BsonSchema } {
  const object = f.object(shape);
  return {
    zod: z.strictObject(zodShape(shape)),
    jsonSchema: {
      ...object.bson,
      ...(rules.oneOf ? { oneOf: rules.oneOf } : {}),
      ...(rules.allOf ? { allOf: rules.allOf } : {}),
    },
  };
}
