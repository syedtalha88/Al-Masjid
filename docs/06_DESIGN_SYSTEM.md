# 06 — Design System

> **Visual source of truth:** `docs/design-references/*.png` (3 sheets × 4 screens). Open them before building any screen. This doc extracts their language into tokens and components so every screen — including ones not in the references (onboarding, Qibla, videos, settings, admin) — looks like it belongs to the same premium app.
> Feel: calm, clean, spacious, warm off-white canvas, deep emerald green, soft mint surfaces, rounded generous cards, very subtle shadows, crisp typography, Arabic set beautifully. Think "Apple Health meets a well-kept masjid".

## 1. Reference analysis (what we take from each)

| Ref sheet | Screens | Take |
|---|---|---|
| ref-1 | Home, My Masjids, Masjid Detail, Prayer Timings | Large-title headers; masjid card with green tile icon + mint "Next Prayer" panel + 5-prayer strip; tab bar with raised circular **Scan** FAB in the center; Masjid Detail = full-bleed hero photo + overlapping white sheet + Verified badge + 3 circular quick actions + underline tabs + section rows with count badges; Prayer table with Adhan/Jamaat columns, date stepper, Jumu'ah mint card with mosque illustration, info note |
| ref-2 | Announcements, Hadith & Quran, Donation Detail, Updates | Announcement cards with tinted icon circles + category tags (Important red, Event mint, General grey); Hadith hero card with photo, date pill, bookmark; Donation "Received (Reported)" + "Last updated by Masjid Admin"; **Updates timeline** with vertical connector line and colored icons |
| ref-3 | Announcements (alt), Hadith (alt), Dua Requests, Donation Campaign | **Filled dark-green filter chips**; filled segmented control; Hadith card with transliteration + "Share" outline + "Read Full" mint buttons; **Dua cards with embedded mint dua box**; Donation with full-bleed hero, Started/Ends meta row, big **Donate Now** + **Show UPI QR Code** buttons, info footer |

**Resolved variants (use these):**
- Filter rows (Announcements, Updates, Dua) → ref-3 filled chips, horizontally scrollable.
- In-page section tabs (Masjid Detail, Prayer Timings) → ref-1 underline tabs with animated indicator.
- Two-option switch (Hadith | Quran) → ref-3 filled segmented control.
- Hadith/Ayah card → ref-3 layout; the *first* card of the day gets ref-2's photo header with date pill + bookmark.
- Donation → ref-3 layout + ref-2 wording ("Received (reported by masjid)", "Last updated … by Masjid Admin") + ref-2 "Donate via UPI" panel moved into the **Show UPI QR Code** sheet.
- Third-party UPI app logos from ref-2 are **not** used (DECISIONS #18).

## 2. Color tokens (CSS custom properties in `packages/ui/tokens.css`, exposed to Tailwind v4 via `@theme`)

Sampled from references; semantic names only in components.

| Token | Value | Use |
|---|---|---|
| `--color-primary-900` | `#0A3324` | pressed-on-dark, deepest text on mint |
| `--color-primary-800` | `#0E4430` | pressed state of primary buttons |
| `--color-primary-700` | `#13543C` | **Primary** — buttons, FAB, active tab, active chip, headings accents |
| `--color-primary-600` | `#1B6B4C` | hover/focus ring base |
| `--color-primary-500` | `#2C956B` | progress fill, success accents |
| `--color-mint-200` | `#C3E3CF` | borders on mint surfaces |
| `--color-mint-100` | `#DCEEE2` | selected prayer cell, secondary button bg |
| `--color-mint-50` | `#ECF6EE` | Next-prayer panel, dua box, Jumu'ah card, info panels |
| `--color-bg` | `#F8F8F5` | app canvas (warm off-white) |
| `--color-surface` | `#FFFFFF` | cards, sheets, tab bar |
| `--color-surface-muted` | `#F2F3EF` | inactive chips, info notes, table header |
| `--color-border` | `#E6E8E3` | hairlines, dividers |
| `--color-text` | `#111814` | primary text |
| `--color-text-secondary` | `#5B6560` | secondary text |
| `--color-text-tertiary` | `#8A938E` | meta, captions, placeholders |
| `--color-on-primary` | `#FFFFFF` | text/icons on primary |
| `--color-sun` | `#F2B233` | prayer sun icon |
| `--color-sun-bg` | `#FFF4DA` | |
| `--color-danger` | `#C93C3C` | Important tag text, count badge, destructive |
| `--color-danger-bg` | `#FDECEB` | Important tag bg, red icon circle |
| `--color-rose` | `#B4475A` / bg `#FBE3E6` | Illness tag / dua icon circle |
| `--color-info` | `#2E6BE6` / bg `#EAF1FE` | General info icon |
| `--color-slate` | `#5E6B7A` / bg `#EEF1F5` | Inteqal tag/icon (calm, respectful) |
| `--color-purple` | `#6B4FD8` / bg `#F1EDFE` | Chanda |
| `--color-heart` | `#D64550` / bg `#FDECEE` | Donation campaign icon |
| `--color-overlay` | `rgba(10, 20, 15, 0.45)` | sheet backdrop |
| `--color-focus` | `#1B6B4C` | 2px focus ring + 2px offset |

Contrast: all text/background pairs must pass WCAG AA (4.5:1 body, 3:1 large). `text-tertiary` only for ≥ 12px meta on white/bg (verify ratio; darken if a pair fails).

Category → color mapping (icons in circles, tags):
| Category | Icon (Phosphor) | Circle bg / icon color | Tag |
|---|---|---|---|
| Announcement – important | `Megaphone` | danger-bg / danger | "Important" danger-bg/danger |
| Announcement – general | `Info` | info-bg / info | "General" surface-muted / text-secondary |
| Announcement – event | `CalendarBlank` | mint-50 / primary-700 | "Event" mint-50 / primary-700 |
| Announcement – facilities | `Wrench` | sun-bg / #9A6A00 | "Facilities" |
| Announcement – timing | `Clock` | mint-50 / primary-700 | "Timing" |
| Dua – illness | `HandsPraying` | rose-bg / rose | "Illness" |
| Dua – inteqal | `HandsPraying` | slate-bg / slate | "Inteqal" |
| Dua – other | `HandsPraying` | mint-50 / primary-700 | "Other" |
| Hadith / Ayah | `BookOpen` | info-bg / info | – |
| Campaign | `Heart` (fill) | heart-bg / heart | "Active" / "Completed" / "Closed" |
| Chanda | `ChartBar` / `Heart` | purple-bg / purple | – |
| Video / Bayan | `PlayCircle` | mint-50 / primary-700 | – |
| Timing update | `Clock` | mint-50 / primary-700 | – |

## 3. Typography

Fonts (self-hosted, subset, `font-display: swap`, loaded per active locale):
- Latin UI: **Inter** (variable, with `tnum` feature for times/amounts).
- Hindi: **Noto Sans Devanagari** (variable).
- Telugu: **Noto Sans Telugu** (variable).
- Urdu UI: **Noto Nastaliq Urdu** (lazy, only when locale=ur).
- Arabic religious text (all locales): **Amiri** (regular + bold) — for Quran/hadith/dua Arabic only.

Type scale (Latin; other scripts apply the locale adjustments below):
| Token | Size/Line | Weight | Tracking | Use |
|---|---|---|---|---|
| `largeTitle` | 28/34 | 700 | −0.02em | "Assalamu Alaikum", "My Masjids", "Updates" |
| `title1` | 22/28 | 700 | −0.01em | Masjid name on detail, campaign title |
| `title2` | 20/26 | 700 | −0.01em | Next prayer name ("Dhuhr") |
| `headline` | 17/22 | 600 | −0.005em | Card titles, nav-bar title, section titles |
| `body` | 15/22 | 400 | 0 | Body text |
| `callout` | 14/20 | 400 | 0 | Card body, location lines |
| `subheadStrong` | 14/20 | 600 | 0 | "See All", masjid name in timeline |
| `footnote` | 13/18 | 400 | 0 | Secondary lines, "2h 18m left" |
| `caption` | 12/16 | 500 | 0.01em | Meta ("2 hours ago"), tag text, prayer labels |
| `micro` | 11/14 | 600 | 0.01em | Tab bar labels, AM/PM |
| `timeLarge` | 17/22 | 600 | 0, `tnum` | Prayer strip times |
| `amountLarge` | 24/30 | 700 | −0.01em, `tnum` | Donation amounts |
| `arabicHero` | 28/52 | 400 (Amiri) | 0 | Today's hadith/ayah |
| `arabicBody` | 22/40 | 400 (Amiri) | 0 | Dua box, other hadith cards |

Locale adjustments (applied via `[lang]` selectors on `<html>`):
- `hi`, `te`: line-height × 1.12; sizes unchanged; avoid negative tracking.
- `ur`: Nastaliq → size +2px, line-height ≥ 1.9; no letter-spacing; titles clamp lines with extra bottom padding (Nastaliq descenders).
- Numbers/times always Latin digits (`numberingSystem: 'latn'`) in every locale for clarity.

Admin app: base `body` = 17/24, `headline` = 19/26, buttons 18/24 semibold. Everything else scales up proportionally (+2px).

## 4. Spacing, radius, elevation, layout

- Spacing scale (4-pt): `1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40, 12=48`.
- Screen gutter: **20px** (16px under 360px width). Card padding 16. Section gap 24. List row height ≥ 56.
- Radius: `xs 8` (tags), `sm 12` (inputs, small tiles), `md 16` (cards, info notes, dua box), `lg 20` (large cards, image thumbs), `xl 28` (sheet top corners, masjid detail sheet), `full` (chips, pills, circular buttons, FAB).
- Elevation (very soft, warm):
  - `e1` card: `0 1px 2px rgba(17,24,20,.04), 0 4px 14px rgba(17,24,20,.05)`
  - `e2` raised (sticky header on scroll, sheets): `0 -2px 10px rgba(17,24,20,.04), 0 8px 28px rgba(17,24,20,.08)`
  - `fab`: `0 8px 20px rgba(19,84,60,.32), 0 2px 6px rgba(19,84,60,.2)`
- Borders: hairline 1px `--color-border` (0.5px on DPR ≥ 2 via `transform: scaleY(.5)` pseudo-element for dividers).
- Max content width 560px centered (tablets/desktop show the phone-width layout on bg canvas).
- Safe areas: `env(safe-area-inset-*)` on tab bar, sheets, hero, nav bar. `viewport-fit=cover`.
- Hit targets: ≥ 44×44 (app), ≥ 56×56 (admin).

## 5. Iconography & imagery
- Phosphor Icons, `regular` weight at 22–24px for UI; `fill` weight for active tab and status icons; stroke color = semantic token.
- Prayer icons (custom set, drawn to match Phosphor stroke 1.5px, in `packages/ui/icons/prayer`): Fajr (sun on horizon with up-arrow rays), Dhuhr (full sun), Asr (sun lower with shadow), Maghrib (half sun on horizon), Isha (crescent + star).
- Masjid placeholder: green rounded-square tile with white dome+minaret glyph (ref-1 home card).
- Illustrations: simple flat line illustrations in primary/mint (mosque for Jumu'ah card, empty states, onboarding). SVG, < 4 KB each, authored by us. No stock photos in UI chrome; masjid/campaign photos come from admins.
- Images: always with **thumbhash** placeholder (computed at upload, stored with the image key) → crossfade to real image (see 08_MOTION). Aspect ratios: masjid hero 16:10, campaign hero 16:9, list thumbs 3:4 (My Masjids), video thumbs 16:9.

## 6. Components (`packages/ui`) — each with Storybook-like showcase entry at `/_dev/showcase` (dev builds only), component tests, a11y tests and 4-locale snapshots

**Structure & navigation**
- `AppShell` — canvas bg, stack navigator outlet, TabBar.
- `TabBar` — 5 slots: Home, My Masjids, **ScanFab**, Updates, Settings. Height 64 + safe area, surface bg with top hairline; labels `micro`; active = primary-700 + `fill` icon + semibold label; inactive = text-tertiary `regular`. Updates shows a dot/count badge.
- `ScanFab` — 56px circle primary-700, white scan icon (`Scan`), raised −18px above bar, `fab` shadow, 4px surface-colored ring separating it from the bar.
- `NavBar` — two variants: `large` (large title left, trailing actions; collapses into inline centered `headline` title on scroll with hairline appearing) and `inline` (back chevron + centered title + optional subtitle `caption` e.g. masjid name, as in ref-2).
- `UnderlineTabs` — text tabs with a 2.5px primary indicator that slides (shared layout) between tabs; active text primary-700 semibold, inactive text-secondary.
- `SegmentedControl` — pill container `surface-muted`, active segment filled primary-700 with white text (ref-3), sliding thumb.
- `ChipGroup` — horizontally scrollable chips, 36px tall, `full` radius; active filled primary-700/white; inactive surface-muted/text-secondary; scroll fade masks at edges.
- `Sheet` — bottom sheet, top radius 28, grabber, snap points (content height / 90%), drag to dismiss, backdrop overlay, focus trap, `Esc` closes.
- `Dialog` — centered confirm dialog for destructive actions (Clear data, Delete).
- `Toast` — top, pill, auto-dismiss 3s, action optional.

**Content**
- `Card` (variants: plain, mint, outline) · `ListRow` (leading icon/thumb, title, subtitle, meta, trailing badge/chevron; pressable) · `IconCircle` (44 / 48 / 56) · `Tag` · `CountBadge` (red circle, white `caption` bold; "9+") · `VerifiedBadge` (mint-50 pill, check icon, "Verified") · `InfoNote` (surface-muted, info icon, `footnote`) · `Divider` · `SectionHeader` (title + optional "See All").
- `MasjidCard` (Home carousel item), `MasjidListItem` (My Masjids, with 3:4 thumb + next prayer + "N new updates" circle), `MasjidHero` (full-bleed image + overlay buttons + overlapping sheet).
- `NextPrayerPanel` (mint, sun-color icon by prayer, label "Next Prayer"/"Jamaat", prayer name `title2` primary-900, `CountdownText`, chevron).
- `PrayerStrip` (5 equal columns; label `caption` secondary, time `timeLarge`, AM/PM `micro`; current/next prayer cell gets mint-100 rounded highlight that **slides** to the next cell when the time passes).
- `PrayerTable` (header row surface-muted with "Adhan" "Jamaat"; rows icon + name + two times; Friday row variants; today's next row tinted).
- `DateStepper` (two 40px circular icon buttons + center pill with calendar icon and formatted date; tapping the pill opens a date sheet).
- `JumuahCard` (mint card + mosque illustration + rows "Jumu'ah 1 1:30 PM").
- `RamadanCard` (Sehri ends / Iftar with icons; gentle crescent illustration).
- `TimelineList` (Updates): left 44px icon circles connected by a 2px `--color-border` vertical line; content: masjid name `subheadStrong`, title `subheadStrong`, snippet `footnote` 2 lines, time `caption`.
- `AnnouncementCard`, `HadithCard` (+ `hero` variant with photo, date pill, bookmark), `DuaRequestCard` (+ `DuaBox`), `CampaignCard`, `CampaignHero`, `ProgressBar` (12px, full radius, track surface-muted, fill primary-500, animated), `AmountPair` (received vs target), `MetaRow` (Started / Ends / Support with icons), `VideoCard`, `YouTubeFacade` (thumbnail + play; iframe only after tap — DECISIONS #39), `ChandaChart` (8 bars, custom SVG, current week primary, others mint-200).
- `ArabicText` — `dir="rtl"`, `lang="ar"`, Amiri, centered by default, never mirrored by locale, `user-select: text`, larger tap-to-copy affordance in "Read Full".
- `QrCodeView` (SVG QR with quiet zone, white card, payee name below), `UpiActions`.
- `Compass` (see 07 Qibla).

**Controls**
- `Button` — variants `primary` (primary-700 bg, white), `secondary` (mint-100 bg, primary-800 text — ref-3 "Read Full"), `outline` (1.5px primary-700 border, primary-700 text — "Add Another Masjid", "Share"), `ghost`, `danger`; sizes `md` 48px, `lg` 56px (Donate Now), `full` width option; leading/trailing icon; loading state (spinner replaces icon, width locked); disabled.
- `IconButton` (40/44 circle; `onImage` variant: white 36px circle with shadow for hero "…" button; plain white chevron for hero back as in ref-1, with a subtle top gradient scrim behind it for contrast).
- `CircleAction` (44 mint circle + icon + `caption` label below — Notifications / Share / Directions).
- `Switch`, `Checkbox`, `RadioCard` (big selectable cards — onboarding language & Brother/Sister), `TextField`, `TextArea` (with live counter), `SearchField`, `Select` (opens Sheet), `TimeWheel` (iOS-style wheel picker for hours/minutes/AM-PM, 56px rows in admin), `NumberPad` (admin amounts; big keys, ₹ formatting live), `DatePickerSheet`.
- `Skeleton` (shimmer, respects reduced motion) — every card has a matching skeleton.
- `EmptyState` (illustration + headline + body + action).
- `OfflineBanner`, `UpdateAvailableToast`, `InstallPrompt` (Android) / `IosInstallGuide` (animated 3-step illustration).

**Admin-only components** (`packages/ui/admin`)
- `AdminTile` — 2-column grid tiles, min-height 132px, radius 20, white card with 56px icon circle (category color), label `headline` (admin scale) 2 lines max, optional badge.
- `TemplateGrid` — icon + short label tiles for notice templates.
- `PublishBar` — sticky bottom bar: "Notify followers" switch with quota text ("6 of 8 left today") + big primary "Publish" button.
- `PreviewFrame` — shows the musalli rendering inside a phone-shaped rounded frame with language switcher.
- `StepHeader` — "Step 2 of 3" + progress dots.
- `UploadProgress` — circular progress with % for image uploads.
- `SuccessCheck` — animated check (see motion).

## 7. Content & tone
- Warm, respectful, simple words. Islamic greetings where natural ("Assalamu Alaikum", "JazakAllah Khair" in confirmations).
- Use "Jamaat", "Adhan", "Jumu'ah", "Bayan", "Chanda", "Inteqal", "Dua", "Ameen" as-is in English UI (familiar to users); in hi/ur/te use the commonly used native-script forms (translators decide).
- Relative times ("2 hours ago") up to 6 days, then dates ("26 Sep").
- Never shame or alarm; errors suggest what to do.
- Every icon-only button has an i18n `aria-label`.

## 8. Do / Don't
- ✅ Generous whitespace; one primary action per screen; mint for "information panels", primary green for "act".
- ✅ Same card radius and padding everywhere; consistent 20px gutter.
- ❌ No pure black text, no pure white canvas (canvas is warm `--color-bg`; cards are white).
- ❌ No gradients except the hero image scrim; no heavy shadows; no borders thicker than 1.5px.
- ❌ No emoji in UI chrome. No third-party logos.
- ❌ Don't mirror Arabic text blocks, the compass, media controls' progress direction, or phone-number/time strings in RTL.
