// Template params → ICU arguments (02 notice_templates.params, PHASE_03 T3.5): shared by the musalli app (notice
// bodies), the admin preview (C9) and the tests. Kept apart from the starter texts (./templates.ts) so the app bundle
// does not carry them.
import { isE164 } from '@mc/domain/phone';
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
 * `x` becomes `x_start` and `x_end`; numbers stay numbers (for plurals). Values that do not match their declared type
 * are left out, so the message fails to format and the caller falls back to the title only.
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
        if (isE164(value)) result[param.name] = value;
        break;
    }
  }
  return result;
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
