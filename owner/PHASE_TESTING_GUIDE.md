# Phase Testing Guide (for the owner)

> Claude Code runs hundreds of automated tests in every phase. **This guide is the human check on real phones** — the things automated tests can't fully judge: does it feel smooth, look like the designs, work on your actual phones and networks, and make sense to a masjid admin.
> After each phase, Claude Code gives you a **staging link** and a **phase report** (`docs/reports/PHASE_XX_REPORT.md`). Do the checks for that phase below, then tell Claude Code "Phase XX verified" — or report problems using the template at the end.

---

## Before you start (one-time setup)

**Phones you need**
- **Android A** — a cheap/low-end phone if possible (₹8–12k range). This is the most important test device.
- **Android B** — any second Android (for admin vs. musalli at the same time).
- **iPhone** — iOS 16.4 or newer (needed for push testing).
- A laptop with Google Chrome.

**Useful tools (all free)**
- **securityheaders.com** — paste a URL, shows the security grade.
- **Chrome DevTools** (laptop) → right-click → Inspect → toggle device toolbar (phone icon) to simulate phones; **Network** tab → throttling "Slow 4G"; **Lighthouse** tab → run a "Mobile" report.
- **Android "Developer options"** (Settings → About phone → tap "Build number" 7 times) → you can set "Animator duration scale" etc. Not required, but useful.
- A QR scanner (the phone camera is enough).

**How to "install" the app**
- **Android (Chrome):** open the link → menu (⋮) → "Install app" / "Add to Home screen", or use the app's own Install button.
- **iPhone (Safari only):** open the link in **Safari** → Share button → "Add to Home Screen" → open it **from the Home Screen icon**.

**How to judge "smooth"**
Screen changes should glide like iPhone apps — no flashes of white, no jumping text, no stutter. Anything that feels "webby" or janky → report it with a screen recording.

**How to mark results**
Copy the table for the phase into a note and mark ✅ or ❌. For every ❌, record a screen recording (Android: quick settings "Screen record"; iPhone: Control Centre "Screen Recording").

---

## Phase 00 — Foundation & design system

Links from Claude Code: staging app, staging admin, and `/_dev/showcase` on both.

| # | Check | How | Expected |
|---|---|---|---|
| 0.1 | App opens | Open staging app link on Android A and iPhone | Opens fast; warm off-white background; no errors |
| 0.2 | Security grade | Paste staging app URL and admin URL into securityheaders.com | **A+** for both |
| 0.3 | Showcase looks premium | Open `/_dev/showcase`; scroll all components | Matches the style of your 3 reference images: same green, mint panels, rounded cards, clean fonts |
| 0.4 | Languages | In showcase, switch English → हिन्दी → اردو → తెలుగు | All text changes; **Urdu flips the whole layout right-to-left**; no empty boxes "□" instead of letters |
| 0.5 | Navigation feel | In showcase, open the demo screens, go forward/back, swipe from the left edge to go back (from right edge in Urdu) | iPhone-like sliding; swipe follows your finger; can stop halfway and it returns smoothly |
| 0.6 | Android back button | On Android, press the system back button on a demo screen | Goes back one screen with animation (doesn't exit the app) |
| 0.7 | Bottom sheets | Open the demo sheet; drag it up/down; flick it down | Moves with finger; snaps; flick closes it |
| 0.8 | Tab bar | Tap each tab; tap the green center Scan button | Active tab turns green and filled; center button "presses" and bounces back |
| 0.9 | Reduced motion | Android: Settings → Accessibility → "Remove animations" ON (iPhone: Accessibility → Motion → Reduce Motion) → reopen | Screens fade instead of slide. Turn it back OFF after |
| 0.10 | Install | Install on Android A and iPhone | Icon appears on home screen; opens full-screen without browser bar |
| 0.11 | Offline | Open the installed app, turn on Airplane mode, close and reopen | App still opens (shows offline message), doesn't show the browser's "no internet" dinosaur page |
| 0.12 | Update | Tell Claude Code you're ready; it deploys a tiny change; reopen the app | "Update available" message appears; tapping it refreshes |
| 0.13 | Server locked down | Read the `check.sh` result in the report. Then on your laptop open `https://<your VPS IP address>` in a browser | Report shows all **PASS**. The IP address does **not** open the app (connection refused / error) — only the real domain works |
| 0.14 | Rollback | Ask Claude Code to demonstrate a rollback on staging | Previous version is back within a few minutes; then the latest is redeployed |

---

## Phase 01 — Database, passkey login, Super Admin

Claude Code gives you a **private Super Admin invite link** (never share it).

| # | Check | How | Expected |
|---|---|---|---|
| 1.1 | Super Admin passkey | Open the invite link on your phone → "Create my login" | Phone asks for your screen lock (PIN/pattern/face/fingerprint); then you're logged in |
| 1.2 | Second device | Account → "Add another device" → open that link on your 2nd phone/laptop | Second passkey works; both are listed with labels |
| 1.3 | Invite reuse blocked | Open the same original invite link again | "This link was already used" message |
| 1.4 | Create masjid | Super Admin → Masjids → New. Paste a Google Maps link of a real masjid for location | Location filled correctly; follow code like `ABCD-EFGH` generated |
| 1.5 | Location outside India rejected | Try coordinates of Dubai | Error: location must be in India |
| 1.6 | Create admin | Add an admin to that masjid (language: Hindi or Urdu) → "Share on WhatsApp" | WhatsApp opens with a message + link |
| 1.7 | Admin onboarding | On Android B open the admin invite → create login → read undertaking → accept | All screens in chosen language; undertaking must be accepted to continue |
| 1.8 | Activate | Back in Super Admin → activate the masjid | Status changes to Active |
| 1.9 | Revoke | Super Admin → that admin → "Revoke sessions" (it will ask your screen lock again) | Android B gets logged out on its next action |
| 1.10 | Audit log | Super Admin → Audit log | Every action above is listed with time and who did it |
| 1.11 | No screen lock | (Optional) On a phone without a screen lock, try an invite | Clear message: "Your phone needs a screen lock to log in" |
| 1.12 | Big buttons | Look at admin screens in Urdu and Telugu | Big, readable buttons; icons everywhere; nothing cut off |

---

## Phase 02 — Musalli app core

Claude Code seeds 3 test masjids ("Test Masjid Alpha/Beta/Gamma") on staging and gives you their QR codes/links. **Religious text in test data is fake on purpose** ("Sample translation… Not a real hadith").

| # | Check | How | Expected |
|---|---|---|---|
| 2.1 | First run | Fresh install on Android A → go through onboarding | Language → Brother/Sister → Privacy → Add masjid → Install. Smooth page swipes |
| 2.2 | Scan QR | Tap the green Scan button → point at a test QR on your laptop screen | Brackets snap green, preview sheet, "Follow" → opens masjid page |
| 2.3 | Scan wrong QR | Scan any other QR (e.g., a product QR) | "This is not a Masjid Connect QR code"; nothing opens |
| 2.4 | Enter code | Add Masjid → Enter code → type the code in lowercase with a space | Accepted |
| 2.5 | iPhone camera path | On iPhone, scan a test QR with the **normal Camera app** | Safari page explains to open the installed app and tap Scan (shows the code) |
| 2.6 | Home screen | Follow 2–3 masjids → Home | Looks like reference sheet 1, screen 1: greeting, Hijri date, masjid cards you can swipe, next prayer + countdown, 5 prayer times, recent updates |
| 2.7 | Countdown | Watch the countdown when a minute changes | Numbers roll smoothly; times are correct for the masjid |
| 2.8 | Masjid page | Tap a masjid card | Picture slides/morphs into a big header image; white sheet with Verified badge, 3 round buttons, tabs, sections (like reference 1, screen 3) |
| 2.9 | Directions & Share | Tap Directions; tap Share | Google Maps opens to the masjid; share sheet/WhatsApp with link |
| 2.10 | Prayer Timings | Masjid → Prayer Timings; tap next/previous day arrows | Adhan & Jamaat columns; table slides left/right when changing day; Friday shows Jumu'ah |
| 2.11 | Updates tab | Open Updates; tap filter chips | Timeline with colored icons and line (reference 2, screen 4); filters animate |
| 2.12 | Announcements / Hadith / Dua | Open each from the masjid page | Match references 2 and 3 styles; Arabic text looks beautiful and is right-to-left |
| 2.13 | Ameen | On a dua request tap **Ameen** | Bounce + count goes up by 1; tapping again doesn't add more |
| 2.14 | Offline | Airplane mode ON → close app → reopen | Home, timings and updates still show; small "You're offline" banner |
| 2.15 | Urdu | Settings → Language → اردو | Whole app right-to-left; back-swipe from the right edge; Arabic still correct; times/amounts readable |
| 2.16 | Telugu & Hindi | Switch languages and browse every screen | No cut-off text, no "□" boxes |
| 2.17 | Low-end phone feel | Use Android A for 5 minutes: switch tabs, open/close masjids, scroll fast | Smooth; no stutter; no white flashes |
| 2.18 | Unfollow & reorder | My Masjids → Edit → drag to reorder; unfollow one | Order is kept after closing app; unfollowed masjid disappears |
| 2.19 | Clear all data | Settings → My data → Clear all data | Confirmation; app returns to onboarding |
| 2.20 | Android link opening | With app installed on Android, tap a masjid link in WhatsApp | Opens inside the installed app (not a browser tab) — note result either way |
| 2.21 | Speed check | Laptop Chrome → Lighthouse → Mobile report on staging app | Performance ≥ 90, Accessibility ≥ 95 |

---

## Phase 03 — Masjid Admin content tools

Use Android B as admin and Android A / iPhone as musalli.

| # | Check | How | Expected |
|---|---|---|---|
| 3.1 | Change timings | Admin → Prayer Times → change Isha jamaat → Save | Confirmation shows "Isha jamaat 8:15 → 8:30"; musalli phone shows new time within ~1 minute (pull down to refresh to speed up) |
| 3.2 | Maghrib offset | Set Maghrib jamaat = "5 minutes after Adhan" | Musalli sees Maghrib jamaat move correctly on different days |
| 3.3 | Wrong time blocked | Set a jamaat earlier than its adhan | Friendly warning in admin's language; can't save |
| 3.4 | Notice from template | Notice → "No water" → pick 10:00 AM–2:00 PM → Preview → Publish | Preview shows each language; success animation; musalli sees it |
| 3.5 | Template in other language | Set musalli phone to Telugu | The same notice appears in Telugu automatically |
| 3.6 | Own text notice | Write your own short notice in Urdu | Appears as typed, right-to-left |
| 3.7 | Photo privacy | Attach a photo taken with your phone camera | Uploads fine; (Claude Code's report confirms location data was removed from the photo) |
| 3.8 | Hadith | Hadith/Ayah → use today's suggestion → Publish | Musalli sees it as "Today's Hadith" big card (text will be fake placeholder until you import the real library) |
| 3.9 | Dua request | Illness → keep name private ON → attach dua → Publish | Musalli sees "a brother from our community", never the name |
| 3.10 | Edit / delete | My Posts → edit the notice; delete another post | Edit shows "edited"; deleted post disappears for musalli |
| 3.11 | Special dates & Ramadan | Add an Eid salah with 2 times; turn on Ramadan mode | Musalli Home shows Eid card and Sehri/Iftar card |
| 3.12 | Super Admin: library import | Super Admin → Content Library → import the sample file Claude Code gives you → verify one entry | Dry-run report first; verified entry becomes selectable by admins |
| 3.13 | **Real-person usability test** | Give Android B to an imam/committee member who isn't technical. Ask them to do the 5 tasks in the Phase 03 report **without help** | They succeed. Note where they hesitated — tell Claude Code |

---

## Phase 04 — Push notifications

| # | Check | How | Expected |
|---|---|---|---|
| 4.1 | Turn on (Android) | Musalli Android → follow masjid → "Turn on notifications" | Phone permission prompt; Settings → Notifications shows "On" |
| 4.2 | Turn on (iPhone) | iPhone: first try in Safari (not installed), then in the installed Home Screen app | Safari: told to install first. Installed app: permission prompt works |
| 4.3 | Receive | Admin publishes a notice | Both phones get a notification within ~1 minute, with masjid name; in each phone's language |
| 4.4 | Tap opens item | Tap the notification (app closed) | App opens directly on that notice |
| 4.5 | Mute | Musalli: Masjid page → bell button (mute) → admin publishes | No notification from that masjid; content still visible in app |
| 4.6 | Brothers/Sisters | Set iPhone as Sister, Android as Brother; admin publishes a dua (everyone) and (Phase 6) a sisters-only bayan | Everyone gets the dua; only Sister phone gets the sisters-only bayan |
| 4.7 | Quota | Admin publishes with notify ON until quota ends | Admin sees "x of 8 used"; when finished, can still publish without notification |
| 4.8 | Pause all | Super Admin → Settings → Pause all push → publish | No notifications; resume → works again |
| 4.9 | Phone restart | Restart musalli phones; publish again | Notifications still arrive |
| 4.10 | Load test result | Read the Phase 04 report table | 50,000 notifications dispatched in under 3 minutes |

---

## Phase 05 — Donations & chanda

**You will make a real ₹1 payment to your own UPI ID on staging.**

| # | Check | How | Expected |
|---|---|---|---|
| 5.1 | Set up UPI | Admin → Masjid Profile → Payment → scan your own UPI QR with the admin camera | UPI ID and name filled automatically; status "Requested" |
| 5.2 | Approve | Super Admin → Payment approvals → approve (screen lock asked) | Admin sees "Approved — goes live at <time tomorrow>" |
| 5.3 | 24-hour hold | On staging the hold is shortened (e.g. 15 min — Claude Code tells you the value); check just before and after it ends | Old details stay until the hold ends (24 h in production); then new ones go live and followers get "Payment details updated" notice |
| 5.4 | Create campaign | Admin → Donation Drive → Renovation → target ₹1,00,000 → photo → Publish | Musalli screen looks like reference 3, screen 4 (big image, progress bar, Donate Now, Show UPI QR) |
| 5.5 | Donate Now (Android) | Tap Donate Now | Your UPI app opens with the masjid name/UPI filled; pay **₹1** to complete the test |
| 5.6 | Donate Now (iPhone) | Same on iPhone | UPI app opens (or app chooser); pay ₹1 |
| 5.7 | QR sheet | Show UPI QR Code → scan it with **another** phone's UPI app; also "Save QR" → in UPI app use "scan from gallery" | Both work; payee name shown matches |
| 5.8 | Update amount | Admin → Update amount → ₹72,000 | Musalli progress bar animates to 72%; "Received (reported by masjid)" + "Last updated … by masjid admin" |
| 5.9 | Disclaimer | Read the bottom of the campaign page in all 4 languages | "Payments go directly to the masjid's verified UPI account…" |
| 5.10 | Chanda | Admin → Chanda → enter week amount, turn "Show to followers" ON | Musalli masjid page shows Weekly Chanda with bar chart; turning OFF hides it |
| 5.11 | Personal vs business UPI | If the UPI app shows a warning or blocks the payment from Donate Now, note it | (Expected for some personal UPI IDs — the QR path still works; use business UPI for real masjids) |

---

## Phase 06 — Bayan videos

| # | Check | How | Expected |
|---|---|---|---|
| 6.1 | Upload on mobile data | Admin Android B (Wi-Fi off) → Bayan Video → upload a 10-minute phone video → Audience: Everyone | Progress circle moves smoothly |
| 6.2 | Interrupt & resume | Mid-upload turn on Airplane mode for 30 s, then off; also try closing and reopening the app | Upload continues from where it stopped, doesn't restart from 0 |
| 6.3 | Processing → ready | Wait | Admin gets "Video ready"; followers get a notification |
| 6.4 | Playback on weak network | Musalli: Masjid → Bayans → play; Chrome DevTools or move to weak signal | Starts quickly; quality adjusts; no long freezes |
| 6.5 | Player controls | Seek, double-tap sides (±10 s), speed 1.5×, full-screen, picture-in-picture | All work; leaving and reopening remembers position |
| 6.6 | Sisters-only | Upload a "Sisters only" video | Sister phone sees it; Brother phone does not (not in list, no notification) |
| 6.7 | YouTube link | Paste a YouTube link | Shows thumbnail; plays only after tapping |
| 6.8 | Quota | Check the storage bar in admin | Shows used / 20 GB |

---

## Phase 07 — Qibla

| # | Check | How | Expected |
|---|---|---|---|
| 7.1 | Permissions | Home → compass icon → allow location (iPhone: also allow motion) | Clear explanation screens before each permission |
| 7.2 | Accuracy | Stand in a masjid, hold phone flat, compare the arrow with the mihrab/qibla direction | Matches within a few degrees |
| 7.3 | Alignment | Turn slowly until aligned | Turns green, gentle pulse, phone vibrates once (Android) |
| 7.4 | Calibration | Wave phone near a speaker/magnet, then move in figure-8 | Shows calibration message, then recovers |
| 7.5 | Smoothness | Rotate slowly and quickly on Android A | Dial moves smoothly, no jitter or jumps at North |
| 7.6 | No GPS | Deny location → choose a city | Works with the chosen city |
| 7.7 | Laptop | Open Qibla on the laptop | Map mode with a line towards Makkah |
| 7.8 | Urdu | Switch to Urdu | Compass letters N/E/S/W are not mirrored |

---

## Phase 08 — Moderation, grievance, legal, posters

| # | Check | How | Expected |
|---|---|---|---|
| 8.1 | Report | Musalli → any notice → ⋯ → Report → "Misleading" | Thank-you message |
| 8.2 | Moderation timer | Super Admin dashboard | Report appears with a countdown (36 h) |
| 8.3 | Remove | Super Admin → Remove (reason) | Disappears for musallis within ~1 min; admin gets "A post was removed" message |
| 8.4 | Old notification | Tap an old notification for the removed post | "This content is no longer available" |
| 8.5 | Urgent report | Report with reason "personal or private information" (impersonation/intimate) | Appears as **urgent** with 2 h timer; Super Admin push alert |
| 8.6 | Legal order drill | Super Admin → Legal Orders → add a fake order received "now" | 3-hour countdown; alerts at 50%/80% |
| 8.7 | Grievance | Musalli → Settings → Contact & Grievance → submit with your email | Reference number like GR-2026-000001; appears in Super Admin with 24 h acknowledgement timer |
| 8.8 | Legal pages | Read Privacy, Terms, Content Policy in all 4 languages | All present; still marked DRAFT until your lawyer approves |
| 8.9 | Poster | Super Admin → masjid → Generate poster → A4 → print (or save PDF and print at a shop) | Clean poster, Urdu and Telugu text correct, big QR + code |
| 8.10 | Scan printed poster | Stick it on a wall; scan from 1.5 m in normal light | Scans quickly |
| 8.11 | Kill switches | Turn on maintenance banner; turn on admin read-only mode | Banner shows in both apps; admin can't publish (friendly message). Turn both off |
| 8.12 | Audit export | Audit log → Export CSV | File downloads; no secrets inside |

---

## Phase 09 — Hardening, production, Play Store, pilot

| # | Check | How | Expected |
|---|---|---|---|
| 9.1 | Security sign-off | Read `docs/security/ASVS_L2_CHECKLIST.md` summary and abuse-test results in the report | No open high/medium issues; you agree with any accepted risks |
| 9.2 | Load test | Read load-test section of the report | Targets met (CDN ≥ 95%, errors < 0.1%) |
| 9.3 | Restore drills | Read the database restore drill and the "rebuild the server from scratch" drill evidence | Data restored successfully; server rebuilt; time taken noted (server rebuild under 1 hour) |
| 9.3b | Your backups | Confirm you have an offline copy (password manager) of: the VAPID private key, every server env file, the Cloudflare/Atlas/AWS recovery codes | All saved somewhere only you control |
| 9.4 | Runbooks | Read every runbook in `docs/runbooks/` | You understand each step without coding knowledge; ask Claude Code to simplify any you don't |
| 9.5 | Production smoke test | On production URLs: onboarding, follow, admin login (your prod passkeys), publish, notification, donation QR | All work |
| 9.6 | Legal blockers | `owner/LEGAL_THINGS_I_NEED_TO_DO_MYSELF.md` Stage B | All ticked (lawyer review, translations, library, grievance officer, paperwork) |
| 9.7 | Play Store | Install from the internal/closed testing link on Android A | Installs; opens without any browser bar; masjid links open in the app; notifications work |
| 9.8 | Pilot | Onboard 2–3 masjids with paperwork; print posters; train admins with the quick-start sheet | Admins can publish alone after 15 minutes of training |
| 9.9 | Pilot week | Use daily for 7 days; collect feedback from admins and 10+ musallis | Feedback list given to Claude Code; fixes done before wider launch |
| 9.10 | Launch checklist | `docs/LAUNCH_CHECKLIST.md` | Every box ticked |

---

## How to report a problem to Claude Code

Paste this into Claude Code, one problem per message if possible:

```
BUG (Phase XX, check #X.Y)
Phone: <model>, <Android version / iOS version>, <Chrome/Safari>, installed: yes/no
Language: <en/hi/ur/te>   Brother/Sister: <..>
Steps:
1. ...
2. ...
Expected: ...
What happened: ...
How often: always / sometimes / once
Screen recording / screenshot: attached
```

For design issues, attach your screenshot next to the matching reference image and say what's different (spacing, size, color, animation).

**Rule:** don't tell Claude Code "Phase XX verified" until every ❌ for that phase is fixed and re-checked.
