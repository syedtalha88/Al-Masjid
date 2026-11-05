// Template params → ICU arguments (02 notice_templates.params, PHASE_03 T3.5): shared by the musalli app (notice
// bodies), the admin preview (C9) and the tests. Kept apart from the starter texts (./templates.ts) so the app bundle
// does not carry them.
import { formatPhone, isE164 } from '@mc/domain/phone';
import { isCalendarDate, isWallClock } from '@mc/domain/time';

export const TEMPLATE_PARAM_TYPES = [
  'time',
  'date',
  'date_range',
  'time_range',
  'prayer',
  'number',
  'short_text',
  'phone',
] as const;
export type TemplateParamType = (typeof TEMPLATE_PARAM_TYPES)[number];

export interface TemplateParam {
  readonly name: string;
  readonly type: TemplateParamType;
  readonly required: boolean;
}

/** A param value as stored on an item (02 items.template_params). */
export type TemplateValue = string | number | { readonly start: string; readonly end: string };

/** Prayer names a `prayer` param may hold (the keys of `common:prayer.*`). */
export const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'jumuah'] as const;
export type PrayerKey = (typeof PRAYER_KEYS)[number];
const isPrayerKey = (value: unknown): value is PrayerKey =>
  typeof value === 'string' && (PRAYER_KEYS as readonly string[]).includes(value);

/** Unicode LEFT-TO-RIGHT ISOLATE / POP DIRECTIONAL ISOLATE (UAX #9). */
const LRI = '\u2066';
const PDI = '\u2069';

export interface TemplateFormat {
  /** "HH:mm" → "9:15 PM". */
  readonly time: (hhmm: string) => string;
  /** "YYYY-MM-DD" → "26 Sep 2026". */
  readonly date: (date: string) => string;
  /** "isha" → "Isha" in the reader's language. */
  readonly prayer: (name: PrayerKey) => string;
}

/**
 * The ICU arguments of a template notice: each declared param formatted by its type for the reader's locale; a range
 * `x` becomes `x_start` and `x_end`; numbers stay numbers (for plurals); a phone reads "+91 98765 43210", isolated
 * left-to-right. Values that do not match their declared type are left out, so the message fails to format and the
 * caller falls back to the title only.
 */
export function templateArguments(
  values: Readonly<Record<string, TemplateValue>>,
  params: readonly Pick<TemplateParam, 'name' | 'type'>[],
  format: TemplateFormat,
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const param of params) {
    const value = values[param.name];
    if (value === undefined) continue;
    switch (param.type) {
      case 'time':
        if (isWallClock(value)) result[param.name] = format.time(value);
        break;
      case 'date':
        if (isCalendarDate(value)) result[param.name] = format.date(value);
        break;
      case 'time_range':
      case 'date_range': {
        if (typeof value !== 'object') break;
        const valid = param.type === 'time_range' ? isWallClock : isCalendarDate;
        const write = param.type === 'time_range' ? format.time : format.date;
        if (valid(value.start) && valid(value.end)) {
          result[`${param.name}_start`] = write(value.start);
          result[`${param.name}_end`] = write(value.end);
        }
        break;
      }
      case 'prayer':
        if (isPrayerKey(value)) result[param.name] = format.prayer(value);
        break;
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value)) result[param.name] = value;
        break;
      case 'short_text':
        if (typeof value === 'string') result[param.name] = value;
        break;
      case 'phone':
        // Grouped as people read it, in an LTR isolate so Urdu text keeps the digits in order; the app adds a WhatsApp
        // button for it (DECISIONS #132).
        if (isE164(value)) result[param.name] = `${LRI}${formatPhone(value)}${PDI}`;
        break;
    }
  }
  return result;
}

/** A `short_text` value's length limit (a speaker, a lost item, a place — 00 §4.3). */
export const SHORT_TEXT_MAX = 80;
/** A `number` value is a whole number from 0 to this. */
export const NUMBER_PARAM_MAX = 1_000_000;

/**
 * Is `value` a value of a param of `type`? Times "HH:mm", dates "YYYY-MM-DD"; a time range's ends differ (it may run
 * past midnight), a date range ends on or after its start; numbers are whole, 0 to {@link NUMBER_PARAM_MAX}; short
 * texts have 1 to {@link SHORT_TEXT_MAX} characters after trimming; phones are E.164.
 */
export function isTemplateValue(type: TemplateParamType, value: unknown): boolean {
  switch (type) {
    case 'time':
      return isWallClock(value);
    case 'date':
      return isCalendarDate(value);
    case 'time_range':
    case 'date_range': {
      if (typeof value !== 'object' || value === null) return false;
      const { start, end } = value as { start?: unknown; end?: unknown }; // fields checked just below
      if (type === 'time_range') return isWallClock(start) && isWallClock(end) && start !== end;
      return isCalendarDate(start) && isCalendarDate(end) && start <= end;
    }
    case 'prayer':
      return isPrayerKey(value);
    case 'number':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= NUMBER_PARAM_MAX;
    case 'short_text':
      return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= SHORT_TEXT_MAX;
    case 'phone':
      return isE164(value);
  }
}

/**
 * Checks the values an admin filled in for a template (B5, `POST /items/announcement`).
 *
 * @returns the names that are wrong — a required param missing, a value of the wrong form, or a name the template does
 *   not declare; empty when the values can be published.
 */
export function templateValueProblems(
  values: Readonly<Record<string, unknown>>,
  params: readonly Pick<TemplateParam, 'name' | 'type' | 'required'>[],
): string[] {
  const problems: string[] = [];
  for (const param of params) {
    const value = values[param.name];
    if (value === undefined ? param.required : !isTemplateValue(param.type, value)) problems.push(param.name);
  }
  const declared = new Set(params.map((param) => param.name));
  for (const name of Object.keys(values)) if (!declared.has(name)) problems.push(name);
  return problems;
}

/**
 * The ICU argument names a param provides (`hours` of type time_range → `hours_start`, `hours_end`) — what a template
 * text may use (C9 editor check).
 */
export function templateArgumentNames(param: Pick<TemplateParam, 'name' | 'type'>): readonly string[] {
  return param.type === 'time_range' || param.type === 'date_range'
    ? [`${param.name}_start`, `${param.name}_end`]
    : [param.name];
}
