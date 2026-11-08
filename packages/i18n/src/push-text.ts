// Notification words (PHASE_04 T4.3 / T4.4): what the worker puts into a push in each locale — the voice-note suffix
// and the service worker's fallback (`locales/<locale>/push.json`, plain text), and the item labels and prayer names
// the apps show (`common.json` — the same strings, so a push reads like the screen it opens). Server and service
// worker only: the apps get these through i18next.
import enCommon from '../locales/en/common.json' with { type: 'json' };
import en from '../locales/en/push.json' with { type: 'json' };
import hiCommon from '../locales/hi/common.json' with { type: 'json' };
import hi from '../locales/hi/push.json' with { type: 'json' };
import teCommon from '../locales/te/common.json' with { type: 'json' };
import te from '../locales/te/push.json' with { type: 'json' };
import urCommon from '../locales/ur/common.json' with { type: 'json' };
import ur from '../locales/ur/push.json' with { type: 'json' };
import type { Locale } from './locales.ts';

export type PushTextKey = 'voice' | 'fallbackTitle' | 'fallbackBody';
export type AlertType = keyof typeof en.alert;
export type ItemLabelKey = keyof typeof enCommon.item;
export type PrayerNameKey = keyof typeof enCommon.prayer;

const PUSH: Readonly<Record<Locale, typeof en>> = { en, hi, ur, te };
const COMMON = { en: enCommon, hi: hiCommon, ur: urCommon, te: teCommon } as const;

/** A push string in `locale` (`voice` — "🎤 Voice message", `fallbackTitle`, `fallbackBody`). */
export const pushText = (key: PushTextKey, locale: Locale): string => PUSH[locale][key];

/** An admin alert's title and body in `locale` (07 C1 alerts — no arguments; details are in the app). */
export const alertText = (type: AlertType, locale: Locale): { readonly title: string; readonly body: string } =>
  PUSH[locale].alert[type];

/** The item label the apps show (`common.item.<kind>` — "Request for Dua"), English when a locale lacks it. */
export function itemLabel(kind: string, locale: Locale): string {
  const labels: Readonly<Record<string, string>> = COMMON[locale].item;
  const english: Readonly<Record<string, string>> = enCommon.item;
  return labels[kind] ?? english[kind] ?? english['announcement'] ?? kind;
}

/** A prayer's name in `locale` (`common.prayer.<name>`), English when a locale lacks it. */
export function prayerName(name: string, locale: Locale): string {
  const names: Readonly<Record<string, string>> = COMMON[locale].prayer;
  const english: Readonly<Record<string, string>> = enCommon.prayer;
  return names[name] ?? english[name] ?? name;
}
