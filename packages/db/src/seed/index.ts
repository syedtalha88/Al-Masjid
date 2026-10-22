// `@mc/db/seed` — the dev / staging seed (PHASE_02 T2.2): 3 fake masjids (Hyderabad, Delhi, Chennai) with timings,
// Jumu'ah, a special Eid date, Ramadan mode on one masjid, 10 placeholder library entries, 8 notice templates and 30
// published items. RELIGIOUS CONTENT POLICY (CLAUDE.md §2.3, 10 §5): library entries use the fixture placeholders
// verbatim — no Quran, hadith or dua text, translation or reference anywhere. Names are obviously fake.
// Pure document builders plus one writer; scripts/jobs call the writer with `systemScope()` (only they may build one).
import { createHash } from 'node:crypto';

import { rgbaToThumbHash } from '@mc/domain/thumbhash';
import { type Document, Long, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';

// --- deterministic ids (re-seeding replaces the same documents) ---------------------------------------------------

/** A stable UUID v4 for a seed name (version/variant bits set, so the API's UUID v4 parser accepts it). */
export function seedId(name: string): UUID {
  const bytes = createHash('sha256').update(`mc-seed:${name}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return new UUID(Buffer.from(bytes));
}

/** 10 §5 fixture placeholders — verbatim. */
export const PLACEHOLDER = {
  arabic: 'نص تجريبي للعرض فقط',
  transliteration: 'Sample transliteration — DEV ONLY',
  translation: {
    en: 'Sample translation text for development. Not a real hadith.',
    hi: 'विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।',
    ur: 'ترقی کے لیے نمونہ ترجمہ۔ یہ اصل حدیث نہیں ہے۔',
    te: 'అభివృద్ధి కోసం నమూనా అనువాదం. ఇది నిజమైన హదీస్ కాదు.',
  },
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
} as const;

/** The seed masjids' follow codes (Crockford Base32, canonical) — e2e journeys and the owner guide use them. */
export const SEED_FOLLOW_CODES = { alpha: 'TESTA001', beta: 'TESTB002', gamma: 'TESTC003' } as const;
export type SeedMasjidKey = keyof typeof SEED_FOLLOW_CODES;

const SEED_ADMIN = seedId('admin');
const IMPORT_BATCH = seedId('library-batch');

// --- calendar helpers (UTC arithmetic on "YYYY-MM-DD") -----------------------------------------------------------

const shiftDate = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

// --- masjids ---------------------------------------------------------------------------------------------------------

interface SeedMasjid {
  readonly key: SeedMasjidKey;
  readonly name: string;
  readonly nameI18n: { readonly hi: string; readonly ur: string; readonly te: string };
  readonly area: string;
  readonly city: string;
  readonly state: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
}

/**
 * Seed "photos" are generated sky gradients (top colour → bottom colour, RGB) — never real masjid photos (T2.2). No
 * file exists: a two-colour gradient is reproduced almost exactly by its ThumbHash, so the app paints the placeholder
 * for `seed/` keys and requests nothing (DECISIONS #91). Real keys load from the media origin (Phase 3).
 */
export const SEED_PHOTO_GRADIENTS: Readonly<Record<SeedMasjidKey, readonly [readonly number[], readonly number[]]>> = {
  alpha: [
    [43, 58, 103],
    [244, 162, 89],
  ],
  beta: [
    [27, 67, 50],
    [233, 196, 106],
  ],
  gamma: [
    [61, 52, 139],
    [242, 132, 130],
  ],
};

/** RGBA pixels of a seed gradient (`w` × `h`, top to bottom). */
export function seedGradientRgba(key: SeedMasjidKey, w: number, h: number): Uint8Array {
  const [top, bottom] = SEED_PHOTO_GRADIENTS[key];
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const t = h === 1 ? 0 : y / (h - 1);
    for (let x = 0; x < w; x += 1) {
      const offset = (y * w + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const from = top[channel] ?? 0;
        const to = bottom[channel] ?? 0;
        rgba[offset + channel] = Math.round(from + (to - from) * t);
      }
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

/** Media key and ThumbHash of a seed masjid's photo (16:10, like the Masjid Detail hero). */
export function seedPhoto(key: SeedMasjidKey): { key: string; thumbhash: string } {
  const hash = rgbaToThumbHash(80, 50, seedGradientRgba(key, 80, 50));
  return { key: `seed/masjid-${key}`, thumbhash: Buffer.from(hash).toString('base64') };
}

const MASJIDS: readonly SeedMasjid[] = [
  {
    key: 'alpha',
    name: 'Test Masjid Alpha',
    nameI18n: { hi: 'टेस्ट मस्जिद अल्फ़ा', ur: 'ٹیسٹ مسجد الفا', te: 'టెస్ట్ మస్జిద్ ఆల్ఫా' },
    area: 'Banjara Hills',
    city: 'Hyderabad',
    state: 'Telangana',
    address: 'Road No. 1 (test address), Banjara Hills, Hyderabad, Telangana',
    lat: 17.4126,
    lng: 78.4482,
  },
  {
    key: 'beta',
    name: 'Test Masjid Beta',
    nameI18n: { hi: 'टेस्ट मस्जिद बीटा', ur: 'ٹیسٹ مسجد بیٹا', te: 'టెస్ట్ మస్జిద్ బీటా' },
    area: 'Daryaganj',
    city: 'Delhi',
    state: 'Delhi',
    address: 'Test Lane (test address), Daryaganj, New Delhi, Delhi',
    lat: 28.6448,
    lng: 77.2423,
  },
  {
    key: 'gamma',
    name: 'Test Masjid Gamma',
    nameI18n: { hi: 'टेस्ट मस्जिद गामा', ur: 'ٹیسٹ مسجد گاما', te: 'టెస్ట్ మస్జిద్ గామా' },
    area: 'Triplicane',
    city: 'Chennai',
    state: 'Tamil Nadu',
    address: 'Test Street (test address), Triplicane, Chennai, Tamil Nadu',
    lat: 13.0588,
    lng: 80.2756,
  },
];

type Prayer = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
type Jamaat = { jamaat_mode: 'fixed'; jamaat_time: string } | { jamaat_mode: 'offset'; jamaat_offset_min: number };
const auto = (jamaat: Jamaat, adjust = 0) => ({ adhan_mode: 'auto', adhan_adjust_min: adjust, ...jamaat });
const fixed = (time: string): Jamaat => ({ jamaat_mode: 'fixed', jamaat_time: time });
const offset = (minutes: number): Jamaat => ({ jamaat_mode: 'offset', jamaat_offset_min: minutes });

// Fixed jamaats are later than the latest calculated adhan of the year at that place (validated rule jamaat ≥ adhan).
const TIMINGS: Readonly<Record<SeedMasjidKey, { prayers: Record<Prayer, Document>; jumuah: Document[] }>> = {
  alpha: {
    prayers: {
      fajr: auto(offset(20)),
      dhuhr: auto(fixed('13:30')),
      asr: auto(offset(15)),
      maghrib: auto(offset(5)),
      isha: auto(fixed('20:30')),
    },
    jumuah: [
      { seq: 1, khutbah_time: '13:15', jamaat_time: '13:30' },
      { seq: 2, jamaat_time: '14:30' },
    ],
  },
  beta: {
    prayers: {
      fajr: auto(offset(30)),
      dhuhr: auto(fixed('13:45')),
      asr: auto(offset(15), 2),
      maghrib: auto(offset(3)),
      isha: { adhan_mode: 'manual', adhan_time: '21:00', adhan_adjust_min: 0, ...fixed('21:15') },
    },
    jumuah: [{ seq: 1, khutbah_time: '13:30', jamaat_time: '13:45' }],
  },
  gamma: {
    prayers: {
      fajr: auto(offset(15)),
      dhuhr: auto(offset(20)),
      asr: auto(offset(10)),
      maghrib: auto(offset(5)),
      isha: auto(offset(20)),
    },
    jumuah: [
      { seq: 1, jamaat_time: '13:15' },
      { seq: 2, jamaat_time: '14:15' },
    ],
  },
};

// --- library (placeholders only) ---------------------------------------------------------------------------------

const LIBRARY: readonly { kind: 'hadith' | 'ayah' | 'dua'; dua?: 'illness' | 'inteqal' | 'other'; tags: string[] }[] = [
  { kind: 'hadith', tags: ['sample'] },
  { kind: 'hadith', tags: ['sample'] },
  { kind: 'hadith', tags: ['sample'] },
  { kind: 'hadith', tags: ['sample'] },
  { kind: 'ayah', tags: ['sample'] },
  { kind: 'ayah', tags: ['sample'] },
  { kind: 'ayah', tags: ['sample'] },
  { kind: 'dua', dua: 'illness', tags: ['shifa', 'illness'] },
  { kind: 'dua', dua: 'inteqal', tags: ['maghfirah', 'inteqal'] },
  { kind: 'dua', dua: 'other', tags: ['sample'] },
];
const libraryId = (index: number) => seedId(`library-${String(index)}`);

// --- notice templates (product copy; hi/ur/te are drafts — translation_reviewed: false) ----------------------------

type Four = { en: string; hi: string; ur: string; te: string };
type TemplateParam = {
  name: string;
  type: 'time' | 'date' | 'date_range' | 'time_range' | 'prayer' | 'number' | 'short_text';
};
interface SeedTemplate {
  readonly key: string;
  readonly category: 'general' | 'event' | 'facilities' | 'timing';
  readonly icon: string;
  readonly important: boolean;
  readonly params: readonly TemplateParam[];
  readonly title: Four;
  readonly body: Four;
}

/**
 * ICU arguments: a param `x` of a range type is passed as `x_start` and `x_end`; every value is formatted for the
 * reader's locale by the app before the message is formatted (times, dates, prayer names).
 */
export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  {
    key: 'no_water_time_range',
    category: 'facilities',
    icon: 'drop',
    important: true,
    params: [{ name: 'hours', type: 'time_range' }],
    title: { en: 'No water supply', hi: 'पानी की आपूर्ति बंद', ur: 'پانی کی فراہمی بند', te: 'నీటి సరఫరా నిలిపివేత' },
    body: {
      en: 'Water will not be available from {hours_start} to {hours_end}.',
      hi: '{hours_start} से {hours_end} तक पानी उपलब्ध नहीं रहेगा।',
      ur: '{hours_start} سے {hours_end} تک پانی دستیاب نہیں ہوگا۔',
      te: '{hours_start} నుండి {hours_end} వరకు నీరు అందుబాటులో ఉండదు.',
    },
  },
  {
    key: 'electricity_cut_time_range',
    category: 'facilities',
    icon: 'lightning',
    important: false,
    params: [{ name: 'hours', type: 'time_range' }],
    title: { en: 'Power cut', hi: 'बिजली कटौती', ur: 'بجلی بند', te: 'విద్యుత్ నిలిపివేత' },
    body: {
      en: 'There will be no electricity from {hours_start} to {hours_end}.',
      hi: '{hours_start} से {hours_end} तक बिजली नहीं रहेगी।',
      ur: '{hours_start} سے {hours_end} تک بجلی نہیں رہے گی۔',
      te: '{hours_start} నుండి {hours_end} వరకు విద్యుత్ ఉండదు.',
    },
  },
  {
    key: 'jamaat_time_changed',
    category: 'timing',
    icon: 'clock',
    important: false,
    params: [
      { name: 'prayer', type: 'prayer' },
      { name: 'time', type: 'time' },
      { name: 'from', type: 'date' },
    ],
    title: { en: 'Jamaat time changed', hi: 'जमात का समय बदला', ur: 'جماعت کا وقت تبدیل', te: 'జమాత్ సమయం మారింది' },
    body: {
      en: 'From {from}, the {prayer} jamaat will be at {time}.',
      hi: '{from} से {prayer} की जमात {time} बजे होगी।',
      ur: '{from} سے {prayer} کی جماعت {time} بجے ہوگی۔',
      te: '{from} నుండి {prayer} జమాత్ {time}కు జరుగుతుంది.',
    },
  },
  {
    key: 'jumuah_timing',
    category: 'timing',
    icon: 'mosque',
    important: false,
    params: [{ name: 'time', type: 'time' }],
    title: { en: 'Jumu’ah timing', hi: 'जुमा का समय', ur: 'جمعہ کا وقت', te: 'జుమా సమయం' },
    body: {
      en: 'This week’s Jumu’ah jamaat will be at {time}.',
      hi: 'इस हफ़्ते जुमा की जमात {time} बजे होगी।',
      ur: 'اس ہفتے جمعہ کی جماعت {time} بجے ہوگی۔',
      te: 'ఈ వారం జుమా జమాత్ {time}కు జరుగుతుంది.',
    },
  },
  {
    key: 'eid_salah_timing',
    category: 'timing',
    icon: 'crescent',
    important: true,
    params: [
      { name: 'date', type: 'date' },
      { name: 'time', type: 'time' },
    ],
    title: { en: 'Eid salah', hi: 'ईद की नमाज़', ur: 'عید کی نماز', te: 'ఈద్ నమాజ్' },
    body: {
      en: 'Eid salah will be held on {date} at {time}. Please arrive early.',
      hi: 'ईद की नमाज़ {date} को {time} बजे होगी। कृपया जल्दी पहुँचें।',
      ur: 'عید کی نماز {date} کو {time} بجے ہوگی۔ براہِ کرم جلدی تشریف لائیں۔',
      te: 'ఈద్ నమాజ్ {date}న {time}కు జరుగుతుంది. దయచేసి ముందుగా రండి.',
    },
  },
  {
    key: 'bayan_event',
    category: 'event',
    icon: 'calendar',
    important: false,
    params: [
      { name: 'date', type: 'date' },
      { name: 'time', type: 'time' },
      { name: 'speaker', type: 'short_text' },
    ],
    title: { en: 'Bayan', hi: 'बयान', ur: 'بیان', te: 'బయాన్' },
    body: {
      en: 'Bayan by {speaker} on {date} at {time}. Everyone is welcome.',
      hi: '{date} को {time} बजे {speaker} का बयान होगा। सभी का स्वागत है।',
      ur: '{date} کو {time} بجے {speaker} کا بیان ہوگا۔ سب کو خوش آمدید۔',
      te: '{date}న {time}కు {speaker} బయాన్ ఉంటుంది. అందరికీ స్వాగతం.',
    },
  },
  {
    key: 'cleanliness_drive',
    category: 'event',
    icon: 'broom',
    important: false,
    params: [
      { name: 'date', type: 'date' },
      { name: 'time', type: 'time' },
    ],
    title: { en: 'Cleanliness drive', hi: 'मस्जिद की सफ़ाई', ur: 'مسجد کی صفائی', te: 'మస్జిద్ శుభ్రత' },
    body: {
      en: 'Masjid cleanliness drive on {date} at {time}. Volunteers are welcome.',
      hi: '{date} को {time} बजे मस्जिद की सफ़ाई होगी। स्वयंसेवकों का स्वागत है।',
      ur: '{date} کو {time} بجے مسجد کی صفائی ہوگی۔ رضاکاروں کا خیر مقدم ہے۔',
      te: '{date}న {time}కు మస్జిద్ శుభ్రత కార్యక్రమం ఉంటుంది. స్వచ్ఛంద సేవకులకు స్వాగతం.',
    },
  },
  {
    key: 'parking_closed_date_range',
    category: 'facilities',
    icon: 'car',
    important: false,
    params: [{ name: 'days', type: 'date_range' }],
    title: { en: 'Parking closed', hi: 'पार्किंग बंद', ur: 'پارکنگ بند', te: 'పార్కింగ్ మూసివేత' },
    body: {
      en: 'The parking area will be closed from {days_start} to {days_end}.',
      hi: 'पार्किंग {days_start} से {days_end} तक बंद रहेगी।',
      ur: 'پارکنگ {days_start} سے {days_end} تک بند رہے گی۔',
      te: 'పార్కింగ్ {days_start} నుండి {days_end} వరకు మూసి ఉంటుంది.',
    },
  },
];

// --- items -----------------------------------------------------------------------------------------------------------

type ItemSpec =
  | {
      kind: 'free';
      category: 'general' | 'event' | 'facilities' | 'timing';
      title: string;
      body: string;
      locale?: 'en' | 'hi' | 'ur' | 'te';
      important?: boolean;
      audience?: 'everyone' | 'brothers' | 'sisters';
      eventInDays?: number;
    }
  | { kind: 'template'; template: string; params: Document }
  | { kind: 'daily'; library: number; daily: 'hadith' | 'ayah'; note?: string }
  | {
      kind: 'dua';
      library: number;
      category: 'illness' | 'inteqal' | 'other';
      message: string;
      person?: string;
      /** Janaza 5 hours after the request was published. */
      janaza?: { place: string };
    };

/** 30 items, 10 per masjid; `hoursAgo` spreads them over the last three weeks. */
const ITEMS: Readonly<Record<SeedMasjidKey, readonly (ItemSpec & { hoursAgo: number })[]>> = {
  alpha: [
    {
      hoursAgo: 2,
      kind: 'template',
      template: 'no_water_time_range',
      params: { hours: { start: '10:00', end: '14:00' } },
    },
    {
      hoursAgo: 5,
      kind: 'dua',
      library: 7,
      category: 'illness',
      message: 'Please remember Test Person A in your duas. He is unwell and in hospital.',
      person: 'Test Person A',
    },
    { hoursAgo: 20, kind: 'daily', library: 0, daily: 'hadith', note: 'Sample note from the masjid — dev only.' },
    {
      hoursAgo: 30,
      kind: 'free',
      category: 'event',
      title: 'Children’s weekend class',
      body: 'A weekend class for children starts this Saturday after Asr. Parents are requested to register at the office.',
      eventInDays: 2,
    },
    {
      hoursAgo: 52,
      kind: 'template',
      template: 'bayan_event',
      params: { date: 'IN_3_DAYS', time: '20:45', speaker: 'Test Speaker' },
    },
    { hoursAgo: 75, kind: 'daily', library: 4, daily: 'ayah' },
    {
      hoursAgo: 100,
      kind: 'free',
      category: 'general',
      title: 'Sisters’ section open on Fridays',
      body: 'The sisters’ prayer area is open for Jumu’ah. Please use the side entrance.',
      audience: 'sisters',
    },
    {
      hoursAgo: 130,
      kind: 'dua',
      library: 8,
      category: 'inteqal',
      message: 'Please make dua for the maghfirah of a brother from our community who passed away.',
      janaza: { place: 'Test Masjid Alpha' },
    },
    {
      hoursAgo: 200,
      kind: 'free',
      category: 'facilities',
      title: 'Parking area temporarily closed',
      body: 'The parking area will be closed for repair work. Please park on the main road.',
    },
    { hoursAgo: 400, kind: 'daily', library: 1, daily: 'hadith' },
  ],
  beta: [
    {
      hoursAgo: 3,
      kind: 'template',
      template: 'jamaat_time_changed',
      params: { prayer: 'isha', time: '21:15', from: 'TODAY' },
    },
    { hoursAgo: 9, kind: 'daily', library: 2, daily: 'hadith' },
    {
      hoursAgo: 26,
      kind: 'free',
      category: 'general',
      title: 'Iftar arrangement',
      body: 'Iftar will be served in the courtyard every day of Ramadan. Volunteers can contact the office.',
      important: true,
    },
    {
      hoursAgo: 48,
      kind: 'dua',
      library: 9,
      category: 'other',
      message: 'Please make dua for students appearing in their exams this month.',
    },
    {
      hoursAgo: 70,
      kind: 'template',
      template: 'electricity_cut_time_range',
      params: { hours: { start: '09:00', end: '12:00' } },
    },
    {
      hoursAgo: 96,
      kind: 'free',
      category: 'general',
      title: 'मस्जिद में नया वुज़ू खाना',
      body: 'नया वुज़ू खाना अगले हफ़्ते से खुल जाएगा। (टेस्ट संदेश)',
      locale: 'hi',
    },
    { hoursAgo: 150, kind: 'daily', library: 5, daily: 'ayah', note: 'Sample note — dev only.' },
    { hoursAgo: 190, kind: 'template', template: 'cleanliness_drive', params: { date: 'IN_5_DAYS', time: '07:30' } },
    {
      hoursAgo: 260,
      kind: 'free',
      category: 'event',
      title: 'Brothers’ volunteer meeting',
      body: 'A short meeting for brothers who want to help with Ramadan arrangements, after Isha.',
      audience: 'brothers',
    },
    { hoursAgo: 470, kind: 'daily', library: 3, daily: 'hadith' },
  ],
  gamma: [
    { hoursAgo: 1, kind: 'template', template: 'eid_salah_timing', params: { date: 'IN_2_DAYS', time: '07:00' } },
    {
      hoursAgo: 12,
      kind: 'dua',
      library: 7,
      category: 'illness',
      message: 'Please make dua for the quick recovery of an elder of our community.',
    },
    { hoursAgo: 24, kind: 'template', template: 'jumuah_timing', params: { time: '13:15' } },
    { hoursAgo: 40, kind: 'daily', library: 6, daily: 'ayah' },
    {
      hoursAgo: 60,
      kind: 'free',
      category: 'facilities',
      title: 'مسجد میں نئے پنکھے',
      body: 'مسجد میں نئے پنکھے لگا دیے گئے ہیں۔ (ٹیسٹ پیغام)',
      locale: 'ur',
    },
    {
      hoursAgo: 90,
      kind: 'template',
      template: 'parking_closed_date_range',
      params: { days: { start: 'TODAY', end: 'IN_5_DAYS' } },
    },
    {
      hoursAgo: 120,
      kind: 'free',
      category: 'general',
      title: 'మస్జిద్ కార్యాలయ సమయాలు',
      body: 'మస్జిద్ కార్యాలయం ఉదయం 10 నుండి సాయంత్రం 6 వరకు తెరిచి ఉంటుంది. (పరీక్ష సందేశం)',
      locale: 'te',
    },
    {
      hoursAgo: 170,
      kind: 'dua',
      library: 8,
      category: 'inteqal',
      message: 'Please make dua for Test Person B who passed away yesterday.',
      person: 'Test Person B',
      janaza: { place: 'Test Masjid Gamma' },
    },
    { hoursAgo: 300, kind: 'daily', library: 0, daily: 'hadith' },
    {
      hoursAgo: 480,
      kind: 'free',
      category: 'general',
      title: 'Thank you for your support',
      body: 'JazakAllah Khair to everyone who helped with the masjid cleaning last week.',
    },
  ],
};

/** `public_id` of the n-th item of a seed masjid (12 URL-safe characters). */
export const seedPublicId = (masjid: SeedMasjidKey, index: number): string =>
  `seed${masjid.slice(0, 1).toUpperCase()}${String(index).padStart(7, '0')}`;

// --- the seed ----------------------------------------------------------------------------------------------------------

export interface DevSeed {
  readonly masjids: readonly Document[];
  readonly masjidStats: readonly Document[];
  readonly timings: readonly Document[];
  readonly specialTimings: readonly Document[];
  readonly library: readonly Document[];
  readonly templates: readonly Document[];
  readonly items: readonly Document[];
}

const replaceDate = (value: unknown, today: string): unknown => {
  if (value === 'TODAY') return today;
  const match = typeof value === 'string' ? /^IN_(\d+)_DAYS$/.exec(value) : null;
  if (match) return shiftDate(today, Number(match[1]));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, replaceDate(inner, today)]));
  }
  return value;
};

/**
 * Builds the seed documents (valid against the 02 validators) relative to `now`.
 *
 * @param input.now - the moment the seed is written; item times and the Ramadan/Eid dates follow it.
 * @param input.today - IST calendar date of `now` ("YYYY-MM-DD").
 */
export function buildDevSeed(input: { readonly now: Date; readonly today: string }): DevSeed {
  const { now, today } = input;
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
  const masjidId = (key: SeedMasjidKey) => seedId(`masjid-${key}`);
  const masjids = MASJIDS.map((masjid) => ({
    _id: masjidId(masjid.key),
    follow_code: SEED_FOLLOW_CODES[masjid.key],
    name: masjid.name,
    name_i18n: masjid.nameI18n,
    area: masjid.area,
    city: masjid.city,
    state: masjid.state,
    address: masjid.address,
    lat: masjid.lat,
    lng: masjid.lng,
    photo_key: seedPhoto(masjid.key).key,
    photo_thumbhash: seedPhoto(masjid.key).thumbhash,
    status: 'active',
    verified_at: at(24 * 30),
    calc_method: 'karachi',
    asr_madhab: 'hanafi',
    ...(masjid.key === 'gamma' ? { hijri_offset: -1 } : {}),
    show_chanda: false,
    chanda_week_start: 5,
    // Ramadan mode on for the Delhi masjid (Home's Ramadan card; dev data only).
    ...(masjid.key === 'beta' ? { ramadan_start: shiftDate(today, -5), ramadan_end: shiftDate(today, 24) } : {}),
    sehri_precaution_min: masjid.key === 'beta' ? 5 : 0,
    iftar_precaution_min: masjid.key === 'beta' ? 2 : 0,
    push_daily_quota: 8,
    content_version: Long.fromNumber(1),
    admin_count: 0,
    created_at: at(24 * 40),
    updated_at: now,
  }));
  const timings = MASJIDS.map((masjid) => ({
    _id: masjidId(masjid.key),
    prayers: TIMINGS[masjid.key].prayers,
    jumuah: TIMINGS[masjid.key].jumuah,
    masjid_visible: true,
    rev: 1,
    updated_by: SEED_ADMIN,
    updated_at: now,
  }));
  const special = (
    key: SeedMasjidKey,
    type: string,
    days: number,
    times: Document[],
    label?: string,
    note?: string,
  ) => ({
    _id: seedId(`special-${key}-${type}-${String(days)}`),
    masjid_id: masjidId(key),
    type,
    date: shiftDate(today, days),
    ...(label ? { label } : {}),
    times,
    ...(note ? { note } : {}),
    masjid_visible: true,
    created_by: SEED_ADMIN,
    created_at: now,
    updated_at: now,
  });
  const specialTimings = [
    // Eid within the next 3 days → Home's Eid card (00 §4.2).
    special(
      'gamma',
      'eid_ul_fitr',
      2,
      [
        { time: '07:00', label: '1st Jamaat' },
        { time: '08:30', label: '2nd Jamaat' },
      ],
      undefined,
      'Please bring your own prayer mat.',
    ),
    special('beta', 'taraweeh', 0, [{ time: '21:30' }], 'Taraweeh'),
    special('alpha', 'other', 10, [{ time: '20:45' }], 'Annual gathering'),
  ];
  const library = LIBRARY.map((entry, index) => ({
    _id: libraryId(index),
    kind: entry.kind,
    arabic: PLACEHOLDER.arabic,
    transliteration: { en: PLACEHOLDER.transliteration },
    translation: { ...PLACEHOLDER.translation },
    reference: `DEV-SAMPLE-${String(index + 1).padStart(3, '0')}`,
    source_name: PLACEHOLDER.sourceName,
    source_license: PLACEHOLDER.sourceLicense,
    tags: entry.tags,
    ...(entry.dua ? { dua_category: entry.dua } : {}),
    verified_by: 'Development fixture',
    verified_at: now,
    status: 'verified',
    import_batch_id: IMPORT_BATCH,
    search_text: `dev sample ${entry.kind} ${entry.tags.join(' ')}`,
    created_at: now,
    updated_at: now,
  }));
  const templates = SEED_TEMPLATES.map((template) => ({
    _id: template.key,
    category: template.category,
    icon: template.icon,
    is_important_default: template.important,
    title: template.title,
    body: template.body,
    params: template.params.map((param) => ({ name: param.name, type: param.type, required: true })),
    status: 'active',
    translation_reviewed: false,
    system: false,
    created_at: now,
    updated_at: now,
  }));
  const templateOf = new Map(SEED_TEMPLATES.map((template) => [template.key, template]));
  const items = MASJIDS.flatMap((masjid) =>
    ITEMS[masjid.key].map((spec, index) => {
      const published = at(spec.hoursAgo);
      const base = {
        _id: seedId(`item-${masjid.key}-${String(index)}`),
        public_id: seedPublicId(masjid.key, index),
        masjid_id: masjidId(masjid.key),
        status: 'published',
        notify: false,
        masjid_visible: true,
        published_at: published,
        published_version: Long.fromNumber(1),
        created_by: SEED_ADMIN,
        created_at: published,
        updated_at: published,
      };
      switch (spec.kind) {
        case 'free':
          return {
            ...base,
            type: 'announcement',
            audience: spec.audience ?? 'everyone',
            title: spec.title,
            body: spec.body,
            content_locale: spec.locale ?? 'en',
            is_important: spec.important ?? false,
            announcement: {
              category: spec.category,
              ...(spec.eventInDays === undefined
                ? {}
                : { event_at: new Date(`${shiftDate(today, spec.eventInDays)}T11:30:00Z`) }),
            },
          };
        case 'template': {
          const template = templateOf.get(spec.template);
          if (!template) throw new Error(`seed: unknown template ${spec.template}`);
          return {
            ...base,
            type: template.category === 'timing' ? 'timing_update' : 'announcement',
            audience: 'everyone',
            template_key: template.key,
            template_params: replaceDate(spec.params, today),
            is_important: template.important,
            announcement: { category: template.category },
          };
        }
        case 'daily':
          return {
            ...base,
            type: 'daily_content',
            audience: 'everyone',
            is_important: false,
            daily: { library_id: libraryId(spec.library), kind: spec.daily, ...(spec.note ? { note: spec.note } : {}) },
          };
        case 'dua':
          return {
            ...base,
            type: 'dua_request',
            audience: 'everyone',
            body: spec.message,
            content_locale: 'en',
            is_important: spec.category === 'inteqal',
            dua: {
              category: spec.category,
              ...(spec.person ? { person_name: spec.person } : {}),
              name_private: spec.person === undefined,
              library_id: libraryId(spec.library),
              ...(spec.janaza ? { janaza_at: at(spec.hoursAgo - 5), janaza_place: spec.janaza.place } : {}),
            },
          };
      }
    }),
  );
  const masjidStats = MASJIDS.map((masjid) => ({
    _id: masjidId(masjid.key),
    followers: 0,
    ameens_7d: 0,
    updated_at: now,
  }));
  return { masjids, masjidStats, timings, specialTimings, library, templates, items };
}

/** A seed document: string ids for templates, UUIDs elsewhere. */
type SeedDoc = Document & { _id: UUID | string };

/**
 * Writes the seed (replacing earlier seed documents by id, so it is idempotent) and bumps each seed masjid's version
 * so caches refetch. System scope only — `scripts/seed-dev.ts` and the staging seed job build it.
 *
 * @returns how many documents were written.
 * @throws StateError FORBIDDEN unless `scope` is the system scope.
 */
export async function writeDevSeed(handle: DbHandle, scope: Scope, seed: DevSeed): Promise<number> {
  if (scope.kind !== 'system') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  let written = 0;
  const idOf = (doc: Document): UUID | string => {
    const id: unknown = doc['_id'];
    if (id instanceof UUID || typeof id === 'string') return id;
    throw new Error('seed document without an id');
  };
  const put = async (name: string, docs: readonly Document[]) => {
    for (const doc of docs) {
      await db.collection<SeedDoc>(name).replaceOne({ _id: idOf(doc) }, doc, { upsert: true });
      written += 1;
    }
  };
  // Masjids keep their version history: replace everything else, then bump.
  for (const masjid of seed.masjids) {
    const { content_version: _ignored, ...rest } = masjid;
    await db
      .collection<SeedDoc>('masjids')
      .updateOne(
        { _id: idOf(masjid) },
        { $set: rest, $setOnInsert: { content_version: Long.fromNumber(1) } },
        { upsert: true },
      );
    await db
      .collection<SeedDoc>('masjids')
      .updateOne({ _id: idOf(masjid) }, { $inc: { content_version: Long.fromNumber(1) } });
    written += 1;
  }
  await put('masjid_timings', seed.timings);
  await put('special_timings', seed.specialTimings);
  await put('content_library', seed.library);
  await put('notice_templates', seed.templates);
  await put('items', seed.items);
  for (const stats of seed.masjidStats) {
    await db
      .collection<SeedDoc>('masjid_stats')
      .updateOne({ _id: idOf(stats) }, { $setOnInsert: stats }, { upsert: true });
  }
  return written;
}
