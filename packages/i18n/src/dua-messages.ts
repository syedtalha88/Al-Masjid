// Ready-made dua request messages (07 B7, 00 §4.3 "message (template-assisted)", PHASE_03 T3.8): a few plain community
// requests per category in all four languages. B7 fills the message box with one in the language the admin picks; the
// admin may edit it, and the item stores the text and its language. The text lives in
// `locales/<locale>/dua-messages.json`, so translators review it with every other string (review CSV, 09 §3). Never a
// dua, ayah or hadith (CLAUDE.md §2.3) — the attached dua always comes from the verified library.
import en from '../locales/en/dua-messages.json' with { type: 'json' };
import hi from '../locales/hi/dua-messages.json' with { type: 'json' };
import te from '../locales/te/dua-messages.json' with { type: 'json' };
import ur from '../locales/ur/dua-messages.json' with { type: 'json' };
import type { Locale } from './locales.ts';

export type DuaCategory = keyof typeof en;
export const DUA_CATEGORIES: readonly DuaCategory[] = ['illness', 'inteqal', 'other'];

const COPY: Readonly<Record<Locale, typeof en>> = { en, hi, ur, te };

export interface DuaMessage {
  readonly key: string;
  readonly text: string;
}

/** The ready-made messages of `category` in `locale`, in their file order (the first is B7's default). */
export function duaMessages(category: DuaCategory, locale: Locale): readonly DuaMessage[] {
  return Object.entries(COPY[locale][category]).map(([key, text]) => ({ key, text }));
}

/**
 * The message `key` of `category` in `locale`.
 *
 * @returns `undefined` for an unknown key.
 */
export function duaMessage(category: DuaCategory, key: string, locale: Locale): string | undefined {
  return duaMessages(category, locale).find((message) => message.key === key)?.text;
}
