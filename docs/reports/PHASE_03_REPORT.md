# PHASE 03 REPORT — Masjid Admin content tools

> **Status: AWAITING OWNER VERIFICATION** — the checks are in `owner/PHASE_TESTING_GUIDE.md` → Phase 03.
>
> Two things the owner should know first:
> - Photos and voice notes on staging need the rest of **O25**: seven Cloudinary templates and strict mode, done in the
>   console (§7).
> - Three acceptance criteria are met another way. They are listed in §5 (DECISIONS #135); please confirm them
>   when you sign off.

**Date:** 6 Nov 2026 · **Commit range:** `cdd39fa..HEAD` on `feat/phase-03` (123 commits; Phase 03 started
27 Oct 2026) · **Staging URLs:** app https://app-staging.almasjids.com · admin https://admin-staging.almasjids.com ·
**Deployed release:** `863e064` (`main`, CI run 42638983698 green incl. "Release to staging"; live 9 Nov 2026 ~21:10 IST — both `/health` report `863e064`, db + redis ok; migrations 0013–0017 applied by the deploy) — deployed together with Phase 04

## 1. Summary

A masjid admin can now publish everything from the phone, without typing in English:
- prayer and jamaat timings (fixed times, or minutes after the adhan, with one-tap offsets)
- Eid / Taraweeh special dates and Ramadan mode
- notices from 16 translated templates or the admin's own words, with a photo whose location data is removed, or a
  voice note of up to 10 minutes
- today's hadith / ayah, and dua requests with a private-name option, from the scholar-verified Content Library
- adhkar after salah, a Ruqyah list, Ilm contacts (WhatsApp, only with the person's consent; the number is never
  shown) and blood donation camps

Every publish has a preview of the musalli's card in all four languages. Edits and deletions reach musallis at the next
poll. The Super Admin imports and verifies library entries and reviews templates. The five-task usability script
needs at most 6 taps per task, measured in e2e.

## 2. Tasks

| Task | Status | Key files | Tests / evidence |
|---|---|---|---|
| T3.0 Real-screen motion budget (F46) | ✅ owner tolerance (#116) | navigator, ChipGroup, sheets | `screens.perf.spec.ts` within 65 ms / 8 % (strict 08 §8 kept for navigator + fling); CI perf green on `cb1649a`, `b72a5c5`, `aea4aba`; Scan modal axe-clean (#135) |
| T3.1 Admin Home | ✅ (inbox banner later — §5) | `apps/admin/src/routes/index.tsx`, `repos/admin.ts` | `screens.spec` b3, `use-masjid-home.test.tsx` |
| T3.2 Timings editor (B4) | ✅ | `features/timings/`, `state/timings.ts` | journey 6 `timings.spec.ts` (controlled clock), `use-timings-editor.test.tsx` (#115) |
| T3.3 Special dates & Ramadan (B11) | ✅ | `features/special/`, `@mc/domain/special` | `special.spec.ts`, `use-special.test.tsx` (#117) |
| T3.4 Content Library (C8) | ✅ | `features/library/`, `routes/super-library.ts` | import dry-run / step-up / verify int tests, `screens.spec` c8 (#106–#108) |
| T3.5 Notice templates (C9) + ICU | ✅ | `locales/*/templates.json`, `@mc/i18n/template-args` | rendering tests in 4 locales (#111, #112) |
| T3.6 Notice creator (B5) + images | ✅ (progress ring → Phase 9) | `features/notice/`, `media/image.ts` | journey 7 in Telugu, EXIF / polyglot / bomb tests (#119–#121) |
| T3.7 Hadith/Ayah publisher (B6) | ✅ | `features/daily/` | `daily.spec.ts` (#122) |
| T3.8 Dua request creator (B7) | ✅ | `features/dua/` | `dua.spec.ts`, private name never in `v_pub_items` (#123) |
| T3.9 My Posts & edits (B12) | ✅ | `features/posts/` | `posts.spec.ts`, delete gone after one poll (#124) |
| T3.10 Masjid Profile (B13) | ✅ | `features/profile/` | `profile.spec.ts` (#125) |
| T3.11 Shared preview & publish | ✅ | `@mc/ui/content` | `admin-publish.test.tsx` (#113) |
| T3.12 Usability | ✅ | `e2e/admin/usability.spec.ts` | Maghrib **6** · No water **6** · hadith **4** · dua **5** · delete **3** taps (#133) |
| T3.13 Voice notes (B14 + A18) | ✅ (2 criteria another way — §5) | `media/audio.ts`, `VoiceNote.tsx`, `features/voice/` | Chrome/Safari fixtures, polyglot, > 25 MB, 10:01 deleted; `voice-note.test.tsx`; `voice.spec`, `voice-recording.spec` (#126, #128, #135) |
| T3.14 Adhkar after salah (B16 + A20) | ✅ | `features/adhkar/`, `adhkarWindow` | `adhkar.spec.ts` (pinned clock), A20 in 4 locales (#129) |
| T3.15 Ruqyah (B15 + A19) | ✅ | `ruqyah_entries`, `v_pub_ruqyah` | `ruqyah.spec.ts`, A19 in 4 locales (#130) |
| T3.16 Ilm contacts (B17 + A21) | ✅ | `masjid_contacts`, `IlmContactCard` | `contacts.spec.ts`, `ilm.spec.ts` (number never in the page) (#131) |
| T3.17 Blood donation camp (B18 + A22) | ✅ | `BloodCampCard`, `istWindow` | `blood-camp.spec.ts` (pinned clock), A22 in 4 locales (#132) |

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format / i18n | ✅ | 0 warnings; 1327 strings per language awaiting human review (draft translations, as planned) |
| Unit + component (coverage gates) | ✅ | app 162, admin 128, ui 310, i18n 199, domain 192 (100 %), shared 168, api 147, config 66 |
| DB policy matrix / privileges / explain | ✅ | db int **290** (45 namespaces); api int **272** |
| DB privileges on staging Atlas | ⏳ | O36 done 6 Nov 2026: only the expected `extra` lines for the new collections on the old release; must PASS after the deploy |
| Security scans | ✅ | gitleaks, osv-scanner, `pnpm audit`, Semgrep, hadolint, Trivy (CI) |
| E2E (Pixel 7 / iPhone 14) | _CI run on HEAD_ | every Phase 03 spec green locally |
| Accessibility (axe) | ✅ | every new screen axe-clean in 4 locales; serious/critical 0 |
| Bundle budgets | ✅ | musalli initial JS 186.75 / 187 kB gz (owner rule O24); admin 213.2 / 220 kB |
| Lighthouse (mobile) | ✅ | CI `9a391d6`: warm PASS both apps (F56 fixed); cold admin PASS; cold app LCP **2505 ms** — 5 ms over the 2.5 s target, within the recorded 100 ms tolerance (owner rule, #136); performance 95 |
| phase-verifier | fixed → re-run | first run FAIL (3 blockers, 4 should-fix): all fixed or recorded (#135) |
| security-reviewer | 0 HIGH / 0 MEDIUM open | M1, M2 fixed; L2–L5 fixed; L1 tracked as F53 (#135) |

## 4. Screenshots

Every admin screen in en / hi / ur / te: `e2e/admin/screens.spec.ts` → `screens/<locale>/*.png` in the CI Playwright
report, each one axe-checked, with Urdu right-to-left. The new ones in this phase:

- b4 timings / jamaat sheet / preview
- b5 choose / fill / preview / own
- b6 choose / search / note / preview
- b7 category / details / attach / preview
- b11 special (empty, list, edit, preview, new)
- b12 posts / view / delete
- b13 profile / request
- **b14 recorder**
- b15 ruqyah (list, edit, new)
- b16 adhkar / add
- b17 contacts (list, edit, new)
- b18 camp fill
- c8 library (list, import report, entry, verify)
- c9 templates (list, editor, new)

Musalli, in 4 locales:
- A18 voice note (`voice.spec`)
- A19 Ruqyah
- A20 adhkar
- A21 Ilm
- A22 blood camp (`blood-camp.spec`)

The Urdu layouts were checked by eye; for example, `ur/b14-recorder` is mirrored and its "10 منٹ" note reads in the
right order.

## 5. Deviations from spec

- **T3.13 "Removal deletes the media"** — media is not deleted at the moment of removal:
  - A removed item keeps its media for the 180-day evidence period (IT Rules 3(1)(g)).
  - A recording can be used by more than one record.
  - Deletion is done by the Phase 8 `media-delete` job (F52), which removes what nothing references.
  - The storage adapter's delete is tested: a recording that is too long is deleted (#135).
- **T3.13 "musalli plays it (both phones)"** — the e2e plays it on Pixel 7 only. iPhone playback is owner check 3.14
  on staging (#135).
- **F50 polish moved to Phase 9:** the upload progress ring and the Home tile's "just published" pulse (#135).
- **T3.0 motion** — passes within the owner-accepted tolerance of 65 ms / 8 % (#116), not the strict 08 §8 numbers.
- **T3.1 inbox banner** — waits for the inbox it points to (Phase 5 / Phase 8; F57).
- **Cold LCP 2505 ms** (CI) — within a recorded 100 ms tolerance over the 2.5 s target (#136, your rule for small
  overruns).
- **Initial JS 186.75 kB** — over the original 170 kB target, within the owner's 187 kB limit (O24, quality over
  bundle size).

## 6. Known limitations / follow-ups

- **F53** — the 10-minute rule relies on the browser's duration until a real Cloudinary upload shows whether the
  response includes a duration. Checked with O25.
- **F52** — unreferenced media is deleted by the Phase 8 `media-delete` job.
- **F50** — the progress ring and the Home tile pulse are in Phase 9.
- **Local only:** the musalli app's *cold* Lighthouse LCP on the Windows + Docker stack is 2.6–2.7 s, against a 2.5 s
  budget. It was 3.6 s on 5 Nov, before this phase's last changes. CI's cold runs pass, and CI is the gate.
- **Translations:** the hi / ur / te strings are draft translations awaiting human review (`pnpm i18n:review` CSVs).

## 7. What the owner should test now

`owner/PHASE_TESTING_GUIDE.md` → Phase 03, checks 3.1–3.18, including the 5-task usability script with a real masjid
person (3.13, O26).

Before 3.7 (photos) and 3.14 (voice notes) on staging, finish **O25** in the Cloudinary console:
- the 7 templates `mc_480_avif` … `mc_1440_webp` (`c_limit,w_<size>,f_<format>,q_auto`)
- `audio_m4a` (`ac_aac,br_48k`)
- each one allowed for strict transformations
- then strict transformations turned on

Seed data on staging: follow codes **TESTA001**, **TESTB002**, **TESTC003**. Library texts are fake placeholders until
the real library is imported (3.12).
