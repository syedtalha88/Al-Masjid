# Content Library — import file format

For: the owner and content partners who prepare the hadith, ayat, duas and adhkar that masjid admins can publish.

> **Only verified text.** Every entry must come from a licensed source and be checked by a scholar before it is
> verified in the app (CLAUDE.md §2.3, 05 §9). The example below is a **placeholder** — never copy it into a real file.

## How an import works

1. Super Admin → **Content Library** → **Import file** → choose the `.json` file.
2. The app **checks** the file first and shows a report: how many entries are ready, every problem with its row number
   and field, and entries that already exist. Nothing is saved yet.
3. If the report is clean, press **Import … as draft** and confirm with your screen lock. Everything is imported, or
   nothing (one bad row stops the whole file — fix it and choose the file again).
4. Open each draft, compare it with the source, and press **Verify** with the reviewer's name. Only verified entries can
   be chosen by masjid admins and shown in the app.
5. **Retire** an entry to remove it for good. Editing the wording of a verified entry sends it back to draft until it is
   verified again (DECISIONS #108).

## The file

- UTF-8 JSON, at most **4 MB** and **500 entries** — split larger libraries into several files.
- Editors such as VS Code check the file while you type if you point them at `scripts/library.schema.json`.

```json
{
  "format": "masjid-connect-library",
  "version": 1,
  "entries": [
    {
      "kind": "hadith",
      "arabic": "نص تجريبي للعرض فقط",
      "transliteration": { "en": "Sample transliteration — DEV ONLY" },
      "translation": {
        "en": "Sample translation text for development. Not a real hadith.",
        "hi": "विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।",
        "ur": "ترقی کے لیے نمونہ ترجمہ۔ یہ اصل حدیث نہیں ہے۔",
        "te": "అభివృద్ధి కోసం నమూనా అనువాదం. ఇది నిజమైన హదీస్ కాదు."
      },
      "reference": "DEV-SAMPLE-001",
      "source_name": "Development fixture",
      "source_license": "N/A — not for production",
      "tags": ["patience"]
    }
  ]
}
```

## Fields of an entry

| Field | Required | Rules |
|---|---|---|
| `kind` | yes | `hadith`, `ayah`, `dua` or `dhikr` |
| `arabic` | yes | up to 4000 characters; line breaks allowed; the Arabic end-of-ayah and number signs are allowed |
| `translation.en` | yes | English translation, up to 4000 characters |
| `translation.hi` / `.ur` / `.te` | no | Hindi, Urdu, Telugu translations (each up to 4000) — readers see their own language when it exists, else English |
| `transliteration.en` / `.hi` / `.ur` / `.te` | no | pronunciation in Latin, Devanagari, Urdu or Telugu script |
| `reference` | yes | up to 200 characters, e.g. the book and number. **`kind` + `reference` must be unique** in the whole library |
| `source_name` | yes | the publication or dataset, up to 120 characters |
| `source_license` | yes | the licence or permission that allows this use, up to 200 characters |
| `tags` | no | up to 20 lower-case words for the admins' search chips: letters, digits, `-` or `_` (e.g. `shifa`, `after-fajr`) |
| `dua_category` | no | duas only: `illness`, `inteqal` or `other` — suggested for that kind of dua request |
| `repeat` | no | dhikr only: how many times it is said, 1–1000 |
| `occasions` | no | dhikr only: any of `after_salah`, `morning`, `evening` |

Not allowed: any other field name (a typo such as `sourceName` is reported, not ignored), invisible formatting or
direction-override characters, empty texts.

## Common problems in the report

| Report says | Meaning |
|---|---|
| `Row 3 · source_license: …` | the field is missing or empty in the third entry |
| `Row 5 · : Unrecognized key …` | the entry has a field name that is not in the table above |
| `… already in the library` | an entry with the same kind and reference exists (draft, verified or retired) |
| `… repeated in this file` | the same kind and reference appear twice in the file |
| `repeat: only for kind dhikr` | a field was used on the wrong kind |
