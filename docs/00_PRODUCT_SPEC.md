# 00 — Product Specification

> The "what" and "why". Business rules here are binding. Screen layouts are in `07_SCREEN_SPECS.md`; data shapes in `02_DATA_MODEL.md`.

## 1. Vision

A calm, beautiful, trustworthy companion that keeps Indian Muslims connected to **their own local masjids** — accurate jamaat times, community notices, dua requests, transparent fundraising and bayans — without ads, accounts, or tracking. Free forever, distributed masjid-by-masjid through QR posters.

## 2. Users & roles

| Role | Who | How they get in | What they can do |
|---|---|---|---|
| **Musalli** | Any member of the public | Scan masjid QR / open share link / enter follow code. No account. | Follow up to **20** masjids; view all published content; receive push; say Ameen; report content; Qibla; settings. |
| **Masjid Admin** (`owner` or `editor`) | Imam, mutawalli, committee member | Single-use invite link from Super Admin → create passkey | Manage **only their masjid(s)**: timings, special dates, Ramadan settings, posts, dua requests, campaigns, chanda, videos, masjid profile (limited fields). Request UPI change. |
| **Super Admin** | Project owner (+ trusted co-moderators later) | Passkey (seeded at deploy via CLI bootstrap) | Everything: onboard/verify/suspend masjids, invite/revoke admins, approve UPI changes, moderation & takedowns, grievances, legal orders, content library, templates, global settings, audit log, QR posters. |

A masjid has **1–5 admins**. `owner` admins can see the admin list of their masjid; only the Super Admin can add/remove admins (keeps the "who is the legitimate committee" question with a human who has paperwork).

## 3. Core flows

### 3.1 Masjid onboarding (Super Admin)
1. Super Admin collects paperwork offline (see `owner/LEGAL_THINGS_I_NEED_TO_DO_MYSELF.md`).
2. Creates masjid: name (+ optional names in hi/ur/te script), area, city, state, full address, map pin (lat/lng), photo, prayer calculation method, Asr madhab, Hijri offset.
3. Creates admin record (display name, optional contact phone stored encrypted, role) → system issues an **invite link** (valid 72h, single use). Super Admin sends it via WhatsApp.
4. Masjid status `pending` → after admin's first login and accepting the **content undertaking**, Super Admin sets `active` (`verified_at` set). Only `active` masjids are visible to musallis.
5. Super Admin generates the **QR poster** (A4/A5, 4 languages) and prints it.

### 3.2 Admin first login
1. Opens invite link on their phone → sees masjid name and "Create your login" in their chosen language.
2. Taps one button → phone shows its screen-lock prompt → passkey created. Invite consumed.
3. Accepts the content undertaking (versioned, in their language) — required once per version.
4. Lands on the admin home (tiles). A 3-step tooltip tour (skippable) points to Prayer Times, Notice and Publish.

Subsequent logins: open admin app → tap **Login** → screen lock → in. Lost phone → Super Admin revokes sessions/passkeys and issues a recovery invite.

### 3.3 Musalli first run
1. Scan QR (system camera or any QR app) → `https://<app-domain>/m/<CODE>`.
   - Android: opens the installed app if present (WebAPK link capture), otherwise the browser.
   - iOS non-installed: Safari landing → masjid preview card + install guide; following is stored in Safari only, so the guide tells them to tap **Scan** inside the installed app (see DECISIONS #14).
2. Onboarding (first launch only): **Language** (4 big cards in native script) → **Brother / Sister** (with one-line explanation: "Used only to show bayans meant for you. Saved on this phone.") → **Privacy at a glance** (what is stored, nothing personal) → **Add your first masjid** (if not arrived via link) → **Install** prompt → **Notifications** soft-ask (only after at least one masjid is followed and only on a user tap).
3. Home.

### 3.4 Daily use (musalli)
Open app → Home shows greeting, Hijri + Gregorian date, a swipeable card per followed masjid with **next jamaat + live countdown** and today's 5-prayer strip, Ramadan card when active, then **Recent Updates** across all masjids. Tap anything → smooth push into detail.

## 4. Feature rules

### 4.1 Following masjids
- Follow via: QR (in-app scanner or system camera link), WhatsApp/share link (`/m/<CODE>`), manual **follow code** (8 chars Crockford Base32, shown as `ABCD-EFGH`; input is case-insensitive, ignores dashes/spaces, maps O→0, I/L→1).
- Max 20 follows per device (clear message when reached).
- Unfollow from Masjid Detail "…" menu or Settings. Unfollow removes server-side follow record immediately.
- Suspended masjid: disappears from feeds; Masjid Detail shows "This masjid is temporarily unavailable"; push stops.
- Per-masjid **mute** (bell button on Masjid Detail): stops push for that masjid only; content still visible.

### 4.2 Prayer timings
- Five daily prayers + Jumu'ah (1–3 jamaats) per masjid.
- For each daily prayer the admin sets:
  - **Adhan**: `auto` (calculated with `adhan` library using the masjid's coordinates, method and Asr madhab) or `manual HH:mm`.
  - **Jamaat**: `fixed HH:mm` **or** `offset` = N minutes after adhan (common for Maghrib, whose time moves daily). Offset range 0–60.
- Defaults for new masjids: method **Karachi (University of Islamic Sciences)**, Asr **Hanafi**, Maghrib jamaat `offset +5`, others empty (admin must fill before activation).
- Validation: jamaat ≥ adhan (unless crossing midnight for Isha — allowed up to 23:59 only); Fajr jamaat before sunrise warning; Isha after Maghrib.
- **Special dates** (tab "Special Dates"): dated entries with a type (`eid_ul_fitr`, `eid_ul_adha`, `taraweeh`, `shab_e_barat`, `shab_e_qadr`, `other`), label, 1–5 times with optional labels ("1st Jamaat", "2nd Jamaat"), optional note. Eid entries pin to Home for 3 days before the date.
- **Ramadan mode**: admin sets start date + end date (or toggles on/off). While active, Home and Masjid Detail show a Sehri/Iftar card: **Sehri ends** = calculated Fajr (subh sadiq) minus admin precaution minutes (default 0, range 0–15); **Iftar** = calculated sunset (Maghrib adhan) plus admin precaution minutes (default 0, range 0–10). Disclaimer line: "Follow your masjid's announcement if it differs."
- Hijri date: `Intl.DateTimeFormat(..., { calendar: 'islamic-umalqura' })` + offset (global default set by Super Admin, per-masjid override −2…+2) to match Indian moon sighting. Hijri date changes at Maghrib (show next Hijri day after sunset — small "after Maghrib" note).
- Updating timings bumps content version and sends a push **only if** the admin ticks "Notify followers" (default **on** for changes to today's or tomorrow's times; off otherwise).
- Offline: last known schedule + on-device calculation so times always render.

### 4.3 Posts (all share common rules)
Post types: `announcement`, `daily_content` (hadith or ayah), `dua_request`, `campaign` (donation drive), `chanda_update` (auto-generated feed item when weekly chanda is published and visible), `video`.

Common rules:
- Status: `published` → `deleted` (by admin; hidden immediately) or `removed` (by moderation; hidden immediately, preserved 180 days).
- Edits allowed for 24h after publishing; edits do not re-notify. Edited items show "edited".
- Each publish that notifies counts toward the masjid's **daily push quota** (default 8/day, Super Admin adjustable per masjid). When the quota is exhausted the admin can still publish without notification.
- Preview before publish is mandatory; preview shows the post as a musalli will see it, with a language switcher if it's a template.
- Every create/edit/delete writes an audit log entry.

#### Announcements (Notices)
- Category: `general` | `event` | `facilities` | `timing` (filter chips "All / General / Events / Facilities / Timing").
- `important` flag → red "Important" tag + high-urgency push.
- Created from a **template** (recommended) or **free text**.
  - Template: pick from icon grid → fill 0–3 parameters with pickers (time picker, date picker, number) — no typing needed → body rendered per musalli's locale.
  - Free text: title (≤ 80 chars) + body (≤ 1,000 chars), language auto-tagged from admin UI language (editable).
- Optional event date/time (for `event`) → shown as a date badge.
- Optional single image (re-encoded, ≤ 5 MB input).
- Starter templates (owner provides final human-verified translations; Claude Code creates the structure with English source + placeholders): no water (time range), electricity cut (time range), jamaat time changed (prayer, new time, effective date), jumu'ah timing (times), Eid salah timing (times), bayan/lecture event (date, time, speaker), cleanliness/volunteer drive (date, time), parking closed (date range), wudu area maintenance (date range), masjid closed for repair (date range), Taraweeh starts (date, time), Iftar arrangement (date), lost & found (item), general thanks.

#### Daily Hadith / Ayah
- Admin picks from the **Content Library** (search by keyword/category, "Today's suggestion" rotates daily) — no typing. Optional short personal note (≤ 200 chars).
- Displays: Arabic (Amiri font), transliteration (if present), translation in musalli's language (fallback to English if a translation is missing, with a subtle "English" tag), reference.
- Free-form hadith/ayah entry is **not allowed** (prevents misattribution). Super Admin can add library entries after verification.

#### Dua requests
- Category: `illness` | `inteqal` (passed away) | `other`.
- Fields: title auto-generated from category ("Request for Dua"), message (template-assisted, ≤ 500 chars), **person's name optional** with a toggle "Keep name private" (default ON → shows "a brother/sister from our community"). Hint: "Share a name only if the family agrees."
- Attached dua: chosen from the Content Library filtered to the category (e.g., shifa duas for illness, maghfirah duas for inteqal). Shown in a mint box: Arabic, transliteration, translation.
- Janaza details (optional, inteqal only): time + place text.
- Musalli action: **Ameen** button → count increments once per device (animated); shows "1,204 said Ameen".
- Auto-archive after 30 days (still visible under "Older").

#### Donation campaigns
- Fields: title, description (≤ 1,500), cover image, **target amount** (₹, ≥ 1,000), start date, end date (optional), purpose category (`renovation`, `repair`, `utilities`, `welfare`, `other`).
- Uses the masjid's **active payment profile** (VPA + verified payee name). A campaign cannot be created while no active payment profile exists.
- **Received amount** updated manually by admin ("Update amount" → number pad) any time; each update stores a history row (amount, time, admin). UI label: **"Received (reported by masjid)"** + "Last updated <time> by masjid admin".
- Progress bar = received / target (cap visual at 100%, text can show >100%).
- States: `active` → `completed` (target reached or admin marks done) → `closed` (end date passed). Closed campaigns stay visible 30 days with a "Closed" tag.
- Musalli actions: **Donate Now** (opens UPI intent `upi://pay?pa=…&pn=…&tn=<campaign short note>&cu=INR`, no amount), **Show UPI QR Code** (bottom sheet with QR, payee name, VPA with copy button, **Save QR to gallery**, hint "Pay from another phone, or save and scan from gallery in your UPI app").
- Footer note: "Payments go directly to the masjid's verified UPI account. Masjid Connect does not receive or handle any money."
- Max 3 active campaigns per masjid.

#### Weekly chanda
- Admin enters total collected for a week (week starts Friday by default — configurable to Monday), optional note.
- Visibility toggle `show_chanda` on the masjid (default off). When on: Masjid Detail row "Weekly Chanda" → screen with current week amount + last 8 weeks bar chart; publishing a week creates a `chanda_update` feed item (notification optional, default off).

#### Bayan videos
- Upload from phone gallery/camera (MP4/MOV/WebM, ≤ 2 GB, ≤ 120 min) **or** paste a YouTube link.
- Fields: title, speaker (optional), description (optional), **audience** `everyone` | `brothers` | `sisters` (required, no default — admin must choose), language tag.
- Upload is resumable; admin sees progress and can leave the screen (upload continues while the app is open; resumes on return).
- Processing → `ready` triggers the publish + notification. Failed processing → admin sees a retry/delete option.
- Musalli: Masjid Detail row "Bayans" + Updates filter "Bayans". Audience-filtered server-side.
- Per-masjid storage quota (default 20 GB, Super Admin adjustable). Quota bar shown to admin.

### 4.4 Notifications
- Musalli enables via soft-ask sheet → system prompt (requires user tap). iOS: only inside the installed Home Screen app; otherwise show the install guide.
- Every published item from a followed, non-muted masjid notifies, subject to audience, quota, and the "Notify followers" toggle.
- Notification text is localized to the device's locale (template posts) or uses the admin's text (free text), prefixed with the masjid name. Tapping opens the exact item.
- Collapse/replace: notifications use `tag` per item so edits don't stack.
- Updates tab badge = count of items since last opened Updates (computed client-side).

### 4.5 Qibla
- Full-screen compass: Kaaba direction arrow, current heading, degrees from North, distance to Makkah (km), alignment state (green + gentle haptic within ±3°).
- Location from GPS (permission requested on tap), or fallback **choose city** (top 500 Indian cities list bundled, offline) — location never leaves the device.
- iOS motion permission requested on a tap. Calibration prompt when accuracy is poor. If no compass sensor: **map mode** showing the great-circle line from the user to the Kaaba with the bearing, and instructions to align with a landmark.

### 4.6 Settings (musalli)
Language · Brother/Sister · Notifications (status + enable/fix + per-masjid mute list) · Install app (guide) · My masjids (manage) · Privacy policy · Terms · Contact / Grievance · About ("Free forever. No ads, ever. No account. No tracking.") · Clear all data (deletes server device record + local data, with confirm).

### 4.7 Reporting & grievance (musalli)
- "Report" in the "…" menu of every post, video, dua request, campaign and masjid. Reasons: misleading / hateful or offensive / not religious or community related / fraud or fake donation / personal or private information / copyright / other (+ optional details ≤ 500 chars).
- Contact/Grievance form (Settings): category, description, optional contact (email or phone, only if they want a reply). Shows the published Grievance Officer details.

### 4.8 Sharing
- Masjid share: Web Share API → text "Follow <Masjid> on Masjid Connect" + `https://<app-domain>/m/<CODE>`; fallback buttons WhatsApp (`https://wa.me/?text=`) and Copy link.
- Post share: link `https://<app-domain>/p/<postPublicId>` (landing shows the item and a follow button).

## 5. Super Admin capabilities (summary)
Dashboard (SLA alerts first) · Masjids (create, edit, activate, suspend, delete-with-retention, set quotas, per-masjid Hijri offset) · Admins (invite, re-invite, revoke sessions, revoke passkeys, remove) · Payment profile approvals (side-by-side old/new, payee name, approve → 24h hold → active; reject with reason) · Moderation queue (reports with SLA countdown, preview, remove/restore, suspend masjid) · Grievances (ack/resolve with timers) · Legal orders register (3-hour timer) · Content library (import JSON, review, verify, retire) · Notice templates (4-language text, params, icon) · Global settings (Hijri offset, default quotas, maintenance banner) · Audit log (filter by actor/masjid/action/date, export CSV) · QR poster generator · Stats (masjids, followers, push success rate, storage).

## 6. Out of scope (v1)
Musalli accounts, comments/chat, payments processing, maps of all masjids / masjid discovery, admin-to-admin messaging, ads, analytics SDKs, native apps, dark theme, Azan audio playback/alarms (web cannot schedule reliable alarms), machine translation.

## 7. Edge cases to handle explicitly
- Masjid with no timings yet → strip shows "Timings not set yet" (only possible for pending masjids in preview).
- Device clock wrong → countdown uses server time offset from API `Date` header when drift > 2 min.
- Midnight rollover while app open → strip and Hijri date refresh without reload.
- Followed masjid suspended/deleted → graceful card + auto-unfollow option.
- Push subscription expired (410) → server prunes; app re-subscribes on next open if permission still granted.
- Video audience changed after publish → feed updates; previously sent notifications are not recalled.
- Admin belongs to 2 masjids → masjid switcher at top of admin home.
- Two admins editing the same item → optimistic concurrency via `updated_at` precondition; second save gets a friendly "Someone else changed this — reload" sheet.
- Very long Urdu/Telugu text → no clipping; cards grow; titles clamp to 2 lines with "Read more".
- Low storage / private mode → app still works without persistence (warn once).
