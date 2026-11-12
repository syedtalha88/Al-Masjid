// The money lines of donation and chanda notifications (PHASE_05 T5.6): ICU messages the worker fills per locale. The
// "raised of" and "collected" lines are the strings the apps show in Home / Updates rows (`common.json` → `summary`),
// so a push reads like the list it lands in; "New donation campaign · Goal …" exists only in a push (`push.json`).
import enCommon from '../locales/en/common.json' with { type: 'json' };
import en from '../locales/en/push.json' with { type: 'json' };
import hiCommon from '../locales/hi/common.json' with { type: 'json' };
import hi from '../locales/hi/push.json' with { type: 'json' };
import teCommon from '../locales/te/common.json' with { type: 'json' };
import te from '../locales/te/push.json' with { type: 'json' };
import urCommon from '../locales/ur/common.json' with { type: 'json' };
import ur from '../locales/ur/push.json' with { type: 'json' };
import type { Locale } from './locales.ts';

export type ItemLineKey = 'campaignNew' | 'campaignRaised' | 'chandaCollected';

const lines = (push: typeof en, common: typeof enCommon): Readonly<Record<ItemLineKey, string>> => ({
  campaignNew: push.campaignNew,
  campaignRaised: common.summary.raisedOf,
  chandaCollected: common.summary.collected,
});

const LINES: Readonly<Record<Locale, Readonly<Record<ItemLineKey, string>>>> = {
  en: lines(en, enCommon),
  hi: lines(hi, hiCommon),
  ur: lines(ur, urCommon),
  te: lines(te, teCommon),
};

/**
 * The ICU message of a notification's money line in `locale`: `campaignNew` `{target}`, `campaignRaised`
 * `{received}` `{target}`, `chandaCollected` `{amount}` `{date}`.
 */
export const itemLine = (key: ItemLineKey, locale: Locale): string => LINES[locale][key];
