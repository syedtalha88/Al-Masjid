# 07 — Screen Specifications

> Layout, content and behaviour of every screen. Visual details come from `06_DESIGN_SYSTEM.md` and the reference images; motion from `08_MOTION.md`; copy keys from `09_I18N.md`.
> Notation: **[ref-1/2]** = matches reference sheet 1, screen 2. Strings in quotes are English source copy — all go through i18n.
> Every screen has: loading skeleton, empty state, error state with retry, offline behaviour, RTL check, reduced-motion check.

---

# Part A — Musalli app (`apps/app`)

## Navigation map
```
Tab: Home ─┬─ Masjid Detail ─┬─ Prayer Timings
           │                 ├─ Announcements ─ Announcement Detail
Tab: My    │                 ├─ Hadith & Quran ─ Read Full
  Masjids ─┤                 ├─ Dua Requests ─ Dua Detail
           │                 ├─ Donation Campaigns ─ Campaign Detail ─ [UPI QR sheet]
Tab: Scan (modal, full-screen)├─ Weekly Chanda
           │                 └─ Bayans ─ Video Player
Tab: Updates ─ (any item detail)
Tab: Settings ─ Language · Brother/Sister · Notifications · Saved · My data · Install help · Legal pages · Contact/Grievance · About
Home header ─ Qibla (full-screen)
Deep links: /m/:code (Follow landing) · /p/:publicId (Item landing) · /items/:publicId (in-app item)
```
Tabs keep their own navigation stacks (switching tabs preserves scroll and stack). Re-tapping the active tab pops to its root and scrolls to top.

## A1. Onboarding (first launch only; can't be skipped except Install/Notifications)
Full-screen pages, horizontal paging with progress dots at top, primary button pinned at bottom (safe area).
1. **Welcome** — mosque line illustration (animated draw-in), "Assalamu Alaikum", one line "Stay connected with your masjids.", button "Get started".
2. **Language** — title "Choose your language" shown in all 4 scripts stacked small; 4 `RadioCard`s (English · हिन्दी · اردو · తెలుగు), each in its own script, large (72px). Selecting one switches the UI language instantly (with crossfade) and Urdu flips layout to RTL live.
3. **Brother / Sister** — title "Who is using this app?"; two big cards with simple icons: "Brother", "Sister"; helper "Used only to show bayans meant for you. Saved on this phone. You can change it anytime in Settings."
4. **Privacy at a glance** — 3 rows with icons: "No account. No name or phone number.", "Your location never leaves your phone.", "We store only: a random app ID, your language, brother/sister choice, the masjids you follow and a notification token." Links: Privacy Policy, Grievance Officer. Button "Continue" (records privacy version; registers device via API with Turnstile).
5. **Add your first masjid** (skipped if arrived via `/m/:code`) — illustration of QR poster; primary "Scan masjid QR"; secondary "Enter code"; tertiary text button "Later".
6. **Install** (only if not standalone) — Android: "Install app" button triggering `beforeinstallprompt`; iOS Safari: `IosInstallGuide` (Share icon → "Add to Home Screen" → Open from Home Screen) with looping 3-step illustration; "Not now".
7. **Notifications** (≥1 masjid followed, permission `default`; on iOS only inside the installed Home Screen app, on Android in any mode) — bell illustration, "Get timing changes, notices and dua requests from your masjids.", primary "Turn on notifications" (requests permission on tap), "Not now".
Device registration failure → retry banner; onboarding continues offline and registers later.

## A2. Home — [ref-1/1]
- `NavBar` large: "Assalamu Alaikum" (`largeTitle`); subtitle line: Gregorian date · Hijri date (e.g. "Thu, 8 Oct · 16 Rabi' al-Akhir 1448"); trailing: **Qibla** icon button (compass) and **bell** icon with red dot when Updates has unseen items (taps → Updates tab).
- Section "My Masjids" + "See All" (→ My Masjids tab).
- **Masjid carousel**: one `MasjidCard` per followed masjid (order = user's order in My Masjids), snap scrolling with peek of next card (16px), pagination dots below (active dot elongates). Card: green tile icon or masjid photo thumb (if available, 56px rounded 16) + name + area + chevron; `NextPrayerPanel` (next **jamaat**, countdown "2h 18m left", under 10 min → "Starts in 8 min" in primary-700 bold, at time → "Jamaat now" for 10 min); `PrayerStrip` with next prayer highlighted. Fridays: Dhuhr slot shows "Jumu'ah" first jamaat.
- **Ramadan card** (when any followed masjid is in Ramadan mode; uses first such masjid): "Sehri ends 4:52 AM · Iftar 6:14 PM" with countdown to the next of the two.
- **Eid card** (special date within next 3 days): "Eid ul-Fitr Salah — 7:00 AM, 8:30 AM" + masjid name.
- Section "Recent Updates" + "See All" (→ Updates): latest 5 items across followed masjids as `ListRow`s with category icon circles [ref-1/1].
- Empty (no masjids): illustration + "Add your first masjid" + big "Scan QR" button + "Enter code".
- Pull-to-refresh → version check + refetch changed masjids.

## A3. My Masjids — [ref-1/2]
- Large title "My Masjids", trailing primary pill button "+ Add Masjid" (opens Add sheet: Scan / Enter code).
- List of `MasjidListItem`: 3:4 photo thumb (radius 16) or tile icon, name, area, "Next Prayer" + sun icon + prayer + countdown, trailing green count circle "3 new updates" when unseen items exist, chevron. First/selected item card has mint background (ref) — we use mint for the masjid with the soonest jamaat.
- Long-press (or "Edit" in nav) → reorder mode (drag handles) + unfollow buttons.
- Bottom: outline full-width "+ Add Another Masjid".
- Limit reached (20): "You can follow up to 20 masjids."

## A4. Scan (center FAB) — full-screen modal
- Camera view with rounded scan window (animated corner brackets), dimmed surroundings, top close button, torch toggle (if supported), "Enter code instead" button at bottom.
- Permission not granted → explanation card + "Allow camera" (tap triggers permission) ; denied → instructions + "Enter code".
- Detect → haptic + brackets snap green → masjid preview sheet (photo, name, area, Verified, follower count hidden) → "Follow masjid" primary / "Cancel". Already following → "You already follow this masjid" + "Open".
- Invalid QR → shake + "This is not a Masjid Connect QR code".
- **Enter code** sheet: 8-char input as two groups of 4 boxes (`ABCD-EFGH`), auto-uppercase, paste support, auto-submit when complete.
- After follow → success check → navigate to Masjid Detail; if notifications are not yet enabled (and, on iOS, the app is installed) → soft-ask sheet (from Phase 4).

## A5. Masjid Detail — [ref-1/3]
- Full-bleed hero photo (16:10, thumbhash placeholder) with top scrim; overlay: back chevron (white) top-start; "…" in white circle top-end → menu sheet: Share, Mute/Unmute notifications, Report masjid, Unfollow.
- Overlapping white sheet (radius 28 top, overlaps hero 24px): name `title1` + `VerifiedBadge`; location row (pin icon + "Banjara Hills, Hyderabad, Telangana").
- 3 `CircleAction`s: **Notifications** (bell; toggles mute with state shown — bell-slash when muted), **Share**, **Directions** (opens Google Maps directions URL in new tab).
- `UnderlineTabs`: **Overview** · **Prayer Timings** · **Announcements** (tab content swaps with horizontal slide; Prayer Timings tab embeds the same content as A6 without its nav bar).
- Overview: `NextPrayerPanel`; `PrayerStrip` (highlight current); Ramadan card if active; then section rows (`ListRow` with icon, label, count badge of unseen, chevron): Announcements · Hadith & Quran · Dua Requests · Donation Campaigns · Weekly Chanda (only if shown) · Bayans.
- Suspended masjid: hero greyed, message "This masjid is temporarily unavailable", Unfollow button.
- Parallax: hero scales/translates on scroll; nav bar becomes solid with masjid name when hero leaves.

## A6. Prayer Timings — [ref-1/4]
- Inline NavBar: back + "Prayer Timings" + subtitle masjid name.
- `DateStepper`: prev/next day; center pill "Today, 8 Oct 2026" (opens date sheet; range today −7 … +60 days).
- `UnderlineTabs`: **Daily Timings** · **Jumu'ah** · **Special Dates**.
- Daily: `PrayerTable` (Fajr, Sunrise (muted row, adhan column only, label "Sunrise"), Dhuhr/Jumu'ah on Fridays, Asr, Maghrib, Isha) with Adhan + Jamaat columns; next prayer row tinted mint; "auto" adhan times show a tiny "calculated" dot with tooltip "Calculated for this masjid's location".
- `JumuahCard` with each jamaat (and khutbah time if set).
- Special Dates: list of upcoming special timings grouped by date with type icon (Eid crescent, Taraweeh moon), times as chips.
- `InfoNote`: "Timings may change on special occasions. Please check announcements." 
- Hijri date shown under the date pill (small).

## A7. Announcements — [ref-2/1, ref-3/1]
- Inline NavBar: "Announcements" + masjid subtitle (when opened from a masjid; from Updates filter it is cross-masjid and shows masjid name on each card).
- `ChipGroup`: All · General · Events · Facilities · Timing.
- `AnnouncementCard`: icon circle by category; title `headline` 2 lines; time `caption` under title (ref-3) ; body `callout` 3 lines; tag row (Important/Event/General…) + event date badge if any; chevron. Important is shown by the tag only (no extra card accent), as in the reference.
- Detail screen: icon + title, masjid row, full body, image (tap → full-screen pinch-zoom viewer), event date/time with "Add to calendar" (downloads .ics), Share, "…" → Report. "edited" label if edited.

## A8. Hadith & Quran — [ref-2/2, ref-3/2]
- Inline NavBar + masjid subtitle. `SegmentedControl`: Hadith | Quran.
- First (today's) item: `HadithCard hero` — photo header (bundled tasteful image: lantern/book; no people), date pill top-start, bookmark top-end, "Today's Hadith"/"Today's Ayah" mint pill, Arabic `arabicHero`, transliteration, translation (quotes, italic for Latin scripts only), reference, admin note (if any, in a small mint quote box "Note from masjid"), actions: Share (outline) · Read Full (secondary).
- Older items: regular `HadithCard` (ref-3) with date at bottom-end.
- Read Full: full-screen reader — larger Arabic (adjustable size A−/A+ remembered locally), transliteration toggle, translation, reference, source name & license line, copy text button, Share (image card generation is **out of scope v1** → share link).
- Bookmark/Save: stored locally (IndexedDB) → Settings → Saved.

## A9. Dua Requests — [ref-3/3]
- Inline NavBar + masjid subtitle. `ChipGroup`: All · Illness · Inteqal · Other.
- `DuaRequestCard`: icon circle by category; tag (Illness/Inteqal/Other) + time; title "Request for Dua"; message 3 lines (name shown only if not private); `DuaBox` (mint, Arabic `arabicBody`, transliteration, translation) ; footer row: **Ameen** button (secondary pill with hands icon) + "1,204 said Ameen"; chevron.
- Inteqal cards use respectful slate palette and, if janaza info exists, a row "Janaza: after Asr · Masjid Al-Noor" with clock icon.
- Detail: full message, full dua, Ameen button (large), janaza details, Share, Report.
- Ameen interaction: see 08_MOTION §5.6. Already said → button shows "Ameen ✓" (filled state), cannot double count.
- "Older" collapsible section for archived (> 30 days).

## A10. Donation Campaigns list & detail — [ref-3/4 + ref-2/3]
- List: `CampaignCard` (cover 16:9, status tag, title, progress bar, "₹72,000 raised of ₹1,00,000", days left).
- Detail: full-bleed hero (16:9) with status pill top-end (Active filled primary / Completed mint / Closed grey); overlapping sheet; title `title1`; description short; **AmountPair**: "₹72,000" `amountLarge` + "Received (reported by masjid)" `caption` · "₹1,00,000" + "Goal"; `ProgressBar` + "72%" end-aligned; small `InfoNote`-style line "Last updated 26 Sep, 8:30 PM by masjid admin" with clock icon; `MetaRow`: Started 10 Sep 2026 · Ends 31 Oct 2026 · Purpose (Renovation); "About this campaign" section with full description; buttons: **Donate Now** (`lg` primary, full width) and **Show UPI QR Code** (`lg` secondary/surface-muted); footer `InfoNote`: "Payments go directly to the masjid's verified UPI account. Masjid Connect does not receive or handle any money."
- **Donate Now** → `window.location.href = upi://pay?...` built by `packages/domain/upi`. On desktop/no handler → open QR sheet automatically. Show a brief bottom toast "Opening your UPI app…".
- **UPI QR sheet**: payee name `headline` + VPA (`callout`, copy button) + `QrCodeView` (240px) + "Scan with any UPI app from another phone" + **Save QR to gallery** (downloads PNG; iOS opens share sheet with image) + hint "Or save it and use 'Scan from gallery' in your UPI app." + "Payment details changed on 2 Oct" notice if changed in the last 30 days.
- Closed campaign: buttons hidden, banner "This campaign has ended. JazakAllah Khair to everyone who contributed."

## A11. Weekly Chanda
- Inline NavBar. Big card: "This week" + amount `amountLarge` + week range + note; `ChandaChart` last 8 weeks (tap bar → tooltip amount); `InfoNote` "Reported by masjid admin."

## A12. Bayans (videos)
- Inline NavBar + masjid subtitle. List of `VideoCard`: 16:9 thumbnail (radius 16, our own copy — DECISIONS #39) with play glyph, title `headline` 2 lines, speaker · date `caption`, small "YouTube" text tag (no logo).
- Empty: "No bayans yet".
- **Player screen**: 16:9 `YouTubeFacade` at top (sticky): our thumbnail + big play button + one line "Plays from YouTube". On tap only → `youtube-nocookie` iframe with autoplay (YouTube's own controls, full-screen allowed). Below: title, speaker, date, description (expandable), Share, Report. Offline → the facade shows "Connect to the internet to watch" instead of loading.

## A13. Updates — [ref-2/4]
- Large title "Updates". `ChipGroup`: All · Announcements · Dua · Donations · Hadith & Quran · Bayans · Timings · Chanda.
- `TimelineList` merged across followed masjids, newest first, infinite scroll; date section headers ("Today", "Yesterday", "26 Sep").
- Unseen items: small primary dot at row end; opening Updates marks all as seen after 1.5 s visible.
- Tap → item detail (pushes within Updates stack).

## A14. Qibla (full-screen from Home header)
- Top: back/close; title "Qibla Direction".
- Center: `Compass` — circular dial (ticks every 5°, N/E/S/W letters always Latin, not mirrored), rotating with device heading; fixed top indicator; **Kaaba marker** on the dial at the qibla bearing; big arrow from center to Kaaba marker. When aligned (±3°): dial ring and arrow turn primary-500, soft pulse, haptic (Android `navigator.vibrate(30)`), text "You are facing the Qibla".
- Below: "Qibla is 287° from North" (computed), "Distance to Makkah: 3,456 km", current heading, accuracy indicator (good/medium/poor). Location source line: "Using your location" / "Using: Hyderabad" (tap to change city).
- States: need location permission (explain + button) → need motion permission (iOS: button triggers `DeviceOrientationEvent.requestPermission()`) → calibrating (figure-8 animation "Move your phone in a figure 8") → live. No sensor / desktop → **Map mode**: MapLibre map (lazy chunk, tile provider decided in Phase 7 DECISIONS) with a great-circle line from user to Kaaba and bearing text; plus instructions.
- Keep screen awake while open (Wake Lock API where available).

## A15. Settings
Large title "Settings". Grouped list (iOS style, white grouped cards on canvas):
1. Language (current value) → language picker sheet. 
2. Brother / Sister → segmented choice sheet with explanation.
3. Notifications → status ("On", "Off", "Blocked in phone settings", "Install app first (iPhone)") with fix-it flows; list of followed masjids with mute toggles.
4. Saved → saved hadith/ayah/items. Vibration (switch, Android only, default on).
5. Install app → install guide (platform-specific).
6. My data → "What we store" screen showing exactly the device record fields + "Clear all data" (destructive dialog: "This removes all your masjids and settings from this phone and deletes your app ID from our server.").
7. Privacy Policy · Terms · Content Policy · Licenses → legal reader screen.
8. Contact & Grievance → Grievance Officer card (name, email, timelines) + form (category, description, optional contact, Turnstile) → confirmation with reference number.
9. About → app icon, name, version, "Free forever. No ads, ever. No account. No tracking.", "Made for the community."

## A16. Deep-link landings (also served to non-installed browsers)
- `/m/:code`: masjid preview card (photo, name, area, Verified) + "Follow masjid" (if app context) + install guidance. iOS non-standalone: special explainer (DECISIONS #14) with the follow code shown large: "Open the app and enter code ABCD-EFGH".
- `/p/:publicId`: item rendered read-only + "Follow <masjid>" + "Open app".
- Invalid code → friendly not-found with "Scan again".

## A17. System surfaces
- Offline banner (top, 28px, slides in): "You're offline — showing saved timings."
- Update available toast.
- Maintenance banner (from config).
- Annual terms reminder sheet.
- Push notification: title = masjid name, body = item title/first line, icon = app icon (badge monochrome icon for Android), click → `/items/:publicId`.

---

# Part B — Masjid Admin app (`apps/admin`)

Design principles: **icons first, words second, numbers by tapping, never a blank text box when a template exists**. Admin scale typography (06 §3). Admin UI language chosen at first login (same 4 languages; changeable in Profile). Every screen has a big back button and one obvious primary action at the bottom.

## B1. Invite / Login
- Invite landing: masjid name(s) + "As-salamu alaykum, <name>" + language picker (4 flags-free text buttons) + big primary "Create my login" + one line "Your phone will ask for your screen lock (PIN, pattern, face or fingerprint)." → success check → Undertaking.
- Login: app logo, big primary "Login" (passkey) + small "Having trouble? Contact the Masjid Connect team" (shows owner's WhatsApp number from settings).
- Errors in plain language: "Your phone needs a screen lock to log in", "This invite link was already used — ask the Masjid Connect team for a new one".

## B2. Undertaking
- Scrollable plain-language bullet list (icons per point) + checkbox "I agree" + "Continue". Version shown small.

## B3. Admin Home
- Header: masjid photo thumb + name (switcher chevron if multiple masjids) + followers count chip ("1,240 followers").
- Today strip: next jamaat + "Edit timings" small button.
- 2-column `AdminTile` grid (icon circle color per category):
  1. Prayer Times (clock) 2. Notice (megaphone) 3. Hadith / Ayah (book) 4. Dua Request (hands) 5. Donation Drive (heart) 6. Chanda (chart) 7. Bayan Video (play) 8. Special Dates & Ramadan (crescent) 9. My Posts (list) 10. Masjid Profile (gear)
- Bottom: notifications quota pill "Notifications today: 2 of 8 used".
- Inbox banner (if moderation notices / payment status updates).

## B4. Prayer Times editor
- One card per prayer (Fajr…Isha) + Jumu'ah card. Each card: big prayer name + icon; two big buttons "Adhan 5:15 AM (auto)" and "Jamaat 5:30 AM"; tapping opens a `TimeWheel` sheet with: for Adhan → toggle Auto / Set time (+ adjust ±minutes when auto); for Jamaat → Fixed time / Minutes after Adhan (stepper 0–60). Live validation chips ("Jamaat is before Adhan").
- Jumu'ah: up to 3 jamaats (+ khutbah time optional), add/remove.
- Sticky `PublishBar`: "Notify followers" switch (auto-on if today/tomorrow changed) + "Save timings". Confirmation shows a summary diff ("Isha jamaat 8:15 → 8:30").
- Preview button → `PreviewFrame` of the musalli Prayer Timings screen for a chosen date.

## B5. Notice (announcement) creator — 3 steps
1. **Choose**: `TemplateGrid` (icon + short label, in admin language) + last tile "Write your own".
2. **Fill**: template params as big pickers (time range → two wheels; date → calendar sheet; prayer → 5 big buttons; number → `NumberPad`). Category & Important toggle preset by template (editable). Optional photo. Free text path: title + body with counters, language selector chip.
3. **Preview & Publish**: `PreviewFrame` with language switcher (shows how each language sees it), `PublishBar`.
Success: check animation + "Published. 1,240 people will be notified." + buttons "Done" / "View".

## B6. Hadith / Ayah
- Toggle Hadith | Ayah → "Today's suggestion" card (from library, rotates daily, not repeated within 60 days for this masjid) with "Use this" and "Choose another" (search by keyword/topic chips) → optional note → Preview → Publish.

## B7. Dua Request
1. Category (3 big cards: Illness · Inteqal (passed away) · Other).
2. Details: message template picker (e.g., "Please make dua for … who is unwell") or own text; "Name" field optional with "Keep name private" switch (default on) + hint about family consent; for Inteqal: optional Janaza time (wheel) + place.
3. Attach dua: library suggestions for the category (cards showing Arabic + translation); pick one.
4. Preview & Publish.

## B8. Donation Drive
- List of campaigns with progress + "Update amount" big button each.
- Create: purpose (5 icon cards) → title (template suggestions per purpose) + description → target amount (`NumberPad`) + dates → cover photo (camera/gallery; checkbox ownership) → Preview → Publish. Blocked with explanation if no active payment profile ("Set up your masjid's UPI first").
- **Update amount**: `NumberPad` with current value; shows new % live; "Save" → toast; optional "Notify followers" (off by default).
- Mark completed.
- **UPI setup / change** (in Masjid Profile → Payment): current VPA + payee name; "Change UPI" → scan masjid's existing UPI QR with camera (extracts VPA/payee) or type VPA → payee name → note → submit → status timeline: Requested → Approved (on hold until <time>) → Active. Clear warning: "For safety, changes take 24 hours after approval. Followers will be told the payment details changed."

## B9. Chanda
- Week selector (current week default) → amount `NumberPad` → note → "Show chanda to followers" switch (masjid-level, with explanation) → Save (+ notify toggle default off). History list.

## B10. Bayan Video
- YouTube links only (DECISIONS #39). Step 1: short illustrated help "Upload the bayan to your masjid's YouTube channel, then copy its link" + big "Paste link" button (reads the clipboard on tap) and a text field.
- Link checked instantly (friendly errors: "This is not a YouTube video link", "This video is private or can't be shown in other apps") → preview card (thumbnail via our server, title pre-filled and editable) → speaker / description (optional) → **Audience** (3 big cards, required: Everyone · Brothers only · Sisters only). Choosing Sisters only shows a warning card: "Anyone who has this YouTube link can watch it outside the app. Upload it as Unlisted." → ownership checkbox → `PublishBar`.
- Video list: Published / Removed by moderation / Deleted; Edit (≤ 24h), Delete.

## B11. Special Dates & Ramadan
- Special date: type (icon cards) → date → times (add up to 5, each with optional label) → note → Save (+ notify).
- Ramadan: start/end dates, Sehri/Iftar precaution steppers, live preview of today's Sehri/Iftar.

## B12. My Posts
- Filter chips by type; list with status (Published / Removed by moderation / Deleted); actions: Edit (≤ 24h), Delete (confirm), View.
- Removed items show reason category and a link to the content policy.

## B13. Masjid Profile
- Photo (change), names in 4 scripts (view; change requests go to Super Admin), area/address (view), Hijri adjust (−2…+2 with today's Hijri preview), Chanda settings, Payment (B8), Admins list (view; owners only), My account (language, sessions, passkeys list with labels, "Log out", "Log out all devices"), Undertaking (view accepted version).

---

# Part C — Super Admin (`apps/admin` routes under `/super`, desktop-friendly responsive layout with sidebar ≥ 1024px, same design tokens, standard type scale)

## C1. Dashboard
Cards: **SLA alerts** (legal orders, urgent reports, reports, grievances — sorted by due time, red when < 20% time left), Pending payment approvals, Pending masjid activations, Stats (masjids active/pending/suspended, devices, follows, push success 24h, storage used, job lag), Recent audit events.

## C2. Masjids
Table/list with search & status filter → Masjid page: profile edit (all fields incl. map pin picker, names in 4 scripts, calc method, madhab, Hijri offset, quotas), status actions (Activate / Suspend with reason / Delete), admins (invite, re-invite, revoke sessions, revoke passkeys, remove, view phone ★), payment history, follower count, removal history count (90 days), **Generate poster**.

## C3. Poster generator
Print-ready HTML page (A4 and A5 toggles) rendered by the browser (complex scripts shape correctly) → user prints / saves as PDF. Layout: app name + logo, masjid name in all provided scripts, large QR (≥ 10 cm on A4, error correction Q, quiet zone), follow code "ABCD-EFGH", 3-step instructions in all 4 languages with icons (Open camera → Scan → Follow), "Free · No ads · No account", small footer with website. Print CSS: exact colors, no browser headers if possible, crop marks optional.

## C4. Payment approvals
Queue → detail: masjid, requester, old vs new side-by-side (VPA, payee name), requester note, history; checklist (verified with committee by phone, payee name matches masjid/committee account); ★ Approve (shows "Will go live at <time>") / Reject with reason.

## C5. Moderation
Queue with countdown pills; filters (urgent / reports / legal); item preview exactly as musallis see it (with all languages for templates); reports list; masjid context; actions ★ Remove (reason category + note; link legal order/report) / Restore / Dismiss / Suspend masjid / Revoke admin. Removal confirmation states "Hidden for everyone now; preserved privately for 180 days."

## C6. Grievances · C7. Legal Orders
Tables with timers; detail with timeline (received → acknowledged → resolved); ★ reveal contact; resolution note; legal order document upload; audit trail.

## C8. Content Library
Import (JSON upload → schema validation → dry-run report: counts, errors per row, duplicates) → import as `draft` → review screen per entry (Arabic rendering preview, all translations, reference, source & license) → ★ Verify (records verifier name) / Retire. Filters by kind/category/tags/status.

## C9. Templates
List + editor: key, category, icon, important default, params schema builder, text per locale with live ICU preview using sample params, "translation reviewed" checkbox (required before activation).

## C10. Settings · C11. Audit log · C12. Stats
Settings: global Hijri offset, default quotas, maintenance banner (4 languages), legal versions, grievance officer details, support WhatsApp number, kill switches (pause all push, admin read-only mode) ★. Audit: filterable, expandable meta, CSV export ★. Stats: charts (simple bars/lines, custom SVG).
