# Glossary — religious and community terms (09 §3)

These words appear across the UI. Use **exactly** these spellings in every string of a locale; do not
replace them with generic equivalents (e.g. not "prayer group" for Jamaat, not "प्रार्थना" for Dua).

**Status: DRAFT.** The English column is fixed by `docs/09_I18N.md §3`. The Hindi, Urdu and Telugu columns
are Claude Code drafts awaiting the owner's translators — change them here first, then update the locale
files and run `pnpm i18n:review` so the affected strings go back for review.

This file lists _terms only_. It never contains Quran ayat, hadith, duas, translations or transliterations
of religious text (CLAUDE.md §2.3); that content comes only from the owner's licensed import (Phase 3).

| English (fixed) | Meaning in the app                       | Hindi (draft) | Urdu (draft) | Telugu (draft) |
| --------------- | ---------------------------------------- | ------------- | ------------ | -------------- |
| Masjid          | The mosque a musalli follows             | मस्जिद        | مسجد         | మస్జిద్        |
| Jamaat          | Congregational prayer time at the masjid | जमात          | جماعت        | జమాత్          |
| Adhan           | Call to prayer time                      | अज़ान         | اذان         | అజాన్          |
| Jumu'ah         | Friday congregational prayer             | जुमा          | جمعہ         | జుమా           |
| Bayan           | Talk / lecture (bayan videos)            | बयान          | بیان         | బయాన్          |
| Chanda          | Weekly collection totals                 | चंदा          | چندہ         | చందా           |
| Inteqal         | Death notice (dua request type)          | इंतक़ाल       | انتقال       | ఇంతెకాల్       |
| Dua             | Supplication (dua requests)              | दुआ           | دعا          | దువా           |
| Ameen           | Response button on a dua request         | आमीन          | آمین         | ఆమీన్          |
| Hadith          | Label of the daily Hadith card           | हदीस          | حدیث         | హదీస్          |
| Ayah            | Label of the daily Ayah card             | आयत           | آیت          | ఆయత్           |
| Sehri           | Pre-dawn meal end time (Ramadan)         | सहरी          | سحری         | సహరీ           |
| Iftar           | Fast-breaking time (Ramadan)             | इफ़्तार       | افطار        | ఇఫ్తార్        |
| Taraweeh        | Ramadan night prayers                    | तरावीह        | تراویح       | తరావీహ్        |
| Eid             | Eid prayer dates                         | ईद            | عید          | ఈద్            |

## Rules

- Prayer names (Fajr, Dhuhr, Asr, Maghrib, Isha) are added with Phase 2 and follow the same process.
- Urdu strings mix these terms with Latin-only runs (times, amounts, UPI IDs); those runs are wrapped in
  `<bdi>` by the components, never by inserting direction marks into the strings (09 §5).
- Terms that legitimately stay in Latin script in every locale (UPI, QR, WhatsApp, YouTube…) are listed in
  `UNTRANSLATED_WHITELIST` in `tools/check.ts`.
