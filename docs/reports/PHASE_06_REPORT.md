# PHASE 06 REPORT — Bayan videos

> **Status: DRAFT — T6.5 quality gates in progress** (security review running; CI for the branch next). Phase 06 closes
> as "DONE — owner checks pending" under DECISIONS #162; the owner's real-YouTube checks are **O49**.

**Date:** 13 Nov 2026 · **Commits:** `7e1f839..feat/phase-06` (branch on top of Phase 05; T6.1–T6.4 merged into
`main` with Phase 05 on 13 Nov — `5d3123e`) · **Staging:** deploying from `main` `73bb506` (O43 done by the owner) ·
**CI:** pending for the branch.

## 1. Summary

A masjid admin uploads a bayan to the masjid's own YouTube channel and pastes its link in the admin app (B10): the
link is checked at once on the phone, then on the server (strict parser, YouTube oEmbed — private, deleted or
embedding-off videos are refused), and the preview shows **our own sanitized copy** of the thumbnail with YouTube's
title. The admin picks the audience (no default; "Sisters only" warns that anyone with the link can watch it outside
the app — upload it as Unlisted), ticks ownership and publishes; followers of that audience are notified. Musallis see
the bayans in the masjid's Bayans section and Updates (A12); **nothing is loaded from Google or YouTube until they tap
Play**, which inserts the youtube-nocookie player. We store only the 11-character id and the start second — never the
pasted link — and host no video. Deleted posts' thumbnails (and every post's media) are removed after the 180-day
preservation period, with the CDN purged.

## 2. Tasks

| Task | Status | Key files | Tests |
|---|---|---|---|
| T6.1 YouTube link parser + oEmbed adapter | ✅ | `packages/domain/src/youtube.ts`, `packages/api/src/video/youtube.ts` | domain `youtube.test.ts` 61 (fast-check: every accepted form → its id; look-alike hosts refused; round trip), domain 100 %; api `video-youtube.test.ts` 26 + live opt-in (`YOUTUBE_LIVE=1`, green 13 Nov) — #163 |
| T6.2 Admin flow (B10) | ✅ | `db/src/state/videos.ts`, `routes/videos.ts`, `apps/admin/src/routes/videos.{index,new}.tsx` | db `videos.int` 17, api `video-routes.int` 14 (422 invalid / unavailable, 503, link never stored, other masjid 404 without a lookup, 429 after 30/h), admin unit 5, e2e `admin/video.spec.ts` |
| T6.3 Musalli Bayans & player (A12) | ✅ | `packages/ui/src/content/VideoCard.tsx`, `apps/app/src/features/content/{BayansScreen,ItemDetailScreen}.tsx` | ui `video-card.test.tsx` 4; e2e `app/bayans.spec.ts` 8 (journey 10, no Google request before Play, offline, 4 locales) |
| T6.4 Deletion & retention | ✅ | `db/src/state/item-retention.ts`, `api/src/jobs/retention/run.ts`, `api/src/media/cdn-purge.ts` | api `video-routes.int` (179 days nothing / 181 days post + thumbnail + 6 URLs), `cdn-purge.test.ts` 6, db purge test — #164 |
| T6.5 Quality gates | ⏳ | visual `bayans`, `bayan-player`; admin screens B10 ×4 | visual 32/32, screens 8/8, budgets green; security review running |

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ local | 0 warnings |
| Unit + component | ✅ local | domain 281 (100 %), ui + video-card, admin + video 5, api unit + 32 |
| DB integration + policy | ✅ local | db 376 + videos 17 |
| API integration | ✅ local | video-routes 14 (+ suite green, the known Windows worker crash re-run) |
| E2E (Pixel 7, local) | ✅ | bayans 8/8, admin video 1/1, admin screens 8/8 (B10 ×4), payment-owners 1/1; iPhone 14 on CI |
| Accessibility (axe) | ✅ | every new screen in en / hi / ur / te: 0 violations |
| Visual regression | ✅ | 32/32 incl. `bayans`, `bayan-player` × 4 locales × 2 phones |
| Bundle budgets | ✅ | bayans route 0.6 kB, VideoCard 1.1 kB, admin videos.new 1.7 kB (≤ 60 kB); app initial 188.94 / 189 kB |
| CSP | ✅ | the e2e CSP fixture saw no violation; app `frame-src https://www.youtube-nocookie.com` (unchanged), admin `frame-src 'none'` |
| Lighthouse / motion | ⏳ | CI |
| phase-verifier | ⏳ | |
| security-reviewer | ⏳ | link parsing, outbound fetches, CSP, retention |

## 4. Screenshots

Musalli visual baselines `bayans`, `bayan-player` (× en / hi / ur / te × Pixel 7 / iPhone 14). Admin (e2e
attachments): `b10-videos-empty`, `b10-video-new` (preview + Sisters-only warning) × 4 locales, `b10-video-new`,
`b10-videos` (published, sisters). A12 follows 07 A12: 16:9 thumbnail, radius 16, play glyph, title 2 lines,
speaker · date, "YouTube" text tag; the player's facade with "Plays from YouTube" (no reference image exists for A12).

## 5. Deviations from spec

- Preview thumbnail is a `data:image/jpeg` URL of our sanitized copy; nothing is stored until publish (#163).
- Delete uses the common `DELETE /items/:itemId`; no separate `DELETE /videos/:id` (#163).
- T6.4 built the "deleted / removed items" rows of the retention job (Phase 8 T8.7) early, for every post's media (#164).
- "Sign out on every device" now stops an open UPI change (Phase 05 #161 follow-through).
- Shared-element thumbnail → player not built (the phase file calls it progressive) — F71.
- Report ("…") on the player arrives with Phase 8 (moderation), as for every item.

## 6. Known limitations / follow-ups

F71 (shared-element morph, Phase 9 polish). Owner: **O48** real Cloudflare purge token in the worker env (nothing is
due before May 2027), **O49** Phase 06 checks with real YouTube links. Anyone with an Unlisted link can watch it outside
the app — accepted by the owner (#39); the admin is warned.

## 7. What the owner should test now

After staging has Phase 06: `owner/PHASE_TESTING_GUIDE.md` → Phase 06 (6.1–6.7). Use a channel you control: one
**Unlisted** video published as Sisters only, one **Public** as Everyone; a brothers phone must see only the second.
On staging the server asks the real YouTube (`VIDEO_LOOKUP=youtube`).
