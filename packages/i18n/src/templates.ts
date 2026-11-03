// Notice templates (02 notice_templates, 00 §4.3, PHASE_03 T3.5): the starter set every environment starts with, and
// the params → ICU arguments step shared by the musalli app, the admin preview (C9) and the rendering tests. The text
// of the starters lives in `locales/<locale>/templates.json`, so translators review it with every other string
// (review CSV, 09 §3); the database copy is what the apps render (the Super Admin edits it in C9).
import en from '../locales/en/templates.json' with { type: 'json' };
import hi from '../locales/hi/templates.json' with { type: 'json' };
import te from '../locales/te/templates.json' with { type: 'json' };
import ur from '../locales/ur/templates.json' with { type: 'json' };
import type { Locale } from './locales.ts';
import type { TemplateParam, TemplateParamType } from './template-args.ts';

export * from './template-args.ts';

export type Category = 'general' | 'event' | 'facilities' | 'timing';
type Texts = Readonly<Record<Locale, string>>;

/** One starter template: structure here, text from the locale files. */
export interface StarterTemplate {
  readonly key: string;
  readonly category: Category;
  readonly icon: string;
  readonly important: boolean;
  /** System templates are used by the app itself (e.g. "timings updated"), never picked by admins. */
  readonly system: boolean;
  readonly params: readonly TemplateParam[];
  readonly title: Texts;
  readonly body: Texts;
}

const p = (name: string, type: TemplateParamType, required = true): TemplateParam => ({ name, type, required });

const STRUCTURE: readonly Omit<StarterTemplate, 'title' | 'body'>[] = [
  {
    key: 'no_water_time_range',
    category: 'facilities',
    icon: 'drop',
    important: true,
    system: false,
    params: [p('hours', 'time_range')],
  },
  {
    key: 'electricity_cut_time_range',
    category: 'facilities',
    icon: 'lightning',
    important: false,
    system: false,
    params: [p('hours', 'time_range')],
  },
  {
    key: 'jamaat_time_changed',
    category: 'timing',
    icon: 'clock',
    important: false,
    system: false,
    params: [p('prayer', 'prayer'), p('time', 'time'), p('from', 'date')],
  },
  {
    key: 'jumuah_timing',
    category: 'timing',
    icon: 'mosque',
    important: false,
    system: false,
    params: [p('time', 'time')],
  },
  {
    key: 'eid_salah_timing',
    category: 'timing',
    icon: 'crescent',
    important: true,
    system: false,
    params: [p('date', 'date'), p('time', 'time')],
  },
  {
    key: 'bayan_event',
    category: 'event',
    icon: 'calendar',
    important: false,
    system: false,
    params: [p('date', 'date'), p('time', 'time'), p('speaker', 'short_text')],
  },
  {
    key: 'cleanliness_drive',
    category: 'event',
    icon: 'broom',
    important: false,
    system: false,
    params: [p('date', 'date'), p('time', 'time')],
  },
  {
    key: 'parking_closed_date_range',
    category: 'facilities',
    icon: 'car',
    important: false,
    system: false,
    params: [p('days', 'date_range')],
  },
  {
    key: 'wudu_area_maintenance',
    category: 'facilities',
    icon: 'wrench',
    important: false,
    system: false,
    params: [p('days', 'date_range')],
  },
  {
    key: 'masjid_closed_repair',
    category: 'facilities',
    icon: 'warning',
    important: true,
    system: false,
    params: [p('days', 'date_range')],
  },
  {
    key: 'taraweeh_starts',
    category: 'timing',
    icon: 'moon_stars',
    important: false,
    system: false,
    params: [p('date', 'date'), p('time', 'time')],
  },
  {
    key: 'iftar_arrangement',
    category: 'event',
    icon: 'bowl_food',
    important: false,
    system: false,
    params: [p('date', 'date')],
  },
  {
    key: 'lost_and_found',
    category: 'general',
    icon: 'search',
    important: false,
    system: false,
    params: [p('item', 'short_text')],
  },
  { key: 'general_thanks', category: 'general', icon: 'heart', important: false, system: false, params: [] },
  // DECISIONS #104: date, time range, place, contact (rendered as a WhatsApp button by the app).
  {
    key: 'blood_donation_camp',
    category: 'event',
    icon: 'heartbeat',
    important: false,
    system: false,
    params: [p('date', 'date'), p('hours', 'time_range'), p('place', 'short_text'), p('contact', 'phone')],
  },
  // Sent by the app when a masjid saves new timings (T3.2).
  { key: 'timings_updated', category: 'timing', icon: 'clock', important: false, system: true, params: [] },
  // Sent by the app when a masjid saves a special date with "Notify followers" (T3.3).
  {
    key: 'special_timings',
    category: 'timing',
    icon: 'calendar',
    important: false,
    system: true,
    params: [p('date', 'date')],
  },
];

type LocaleFile = Readonly<Record<string, { readonly title: string; readonly body: string }>>;
const FILES: Readonly<Record<Locale, LocaleFile>> = { en, hi, ur, te };
const texts = (key: string, part: 'title' | 'body'): Texts => {
  const read = (locale: Locale) => {
    const value = FILES[locale][key]?.[part];
    if (value === undefined) throw new Error(`templates.json (${locale}) misses ${key}.${part}`);
    return value;
  };
  return { en: read('en'), hi: read('hi'), ur: read('ur'), te: read('te') };
};

/**
 * The starter notice templates (00 §4.3 + #104 blood camp + the system "timings updated" and "special timings"), texts
 * in all 4 locales.
 */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = STRUCTURE.map((template) => ({
  ...template,
  title: texts(template.key, 'title'),
  body: texts(template.key, 'body'),
}));
