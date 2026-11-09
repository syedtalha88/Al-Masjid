# PHASE 04 REPORT — Push notifications

> **Status: AWAITING OWNER VERIFICATION** (on staging since 9 Nov 2026) — the checks are in `owner/PHASE_TESTING_GUIDE.md` → Phase 04.
>
> Two things the owner should know first:
> - **O37 is done** (9 Nov 2026): the notification keys match on the server and in GitHub. Keep the private key backed
>   up — losing it ends every phone's subscription.
> - Real phones are checked only by you (**O38**, checks 4.1–4.4 and 4.12). Headless test browsers cannot subscribe
>   at Google's or Apple's push service, so the e2e tests stop just before it (§5).

**Date:** 9 Nov 2026 · **Commit range:** `d6a6980..HEAD` on `feat/phase-04` (Phase 04 started 8 Nov 2026) ·
**Staging URLs:** app https://app-staging.almasjids.com · admin https://admin-staging.almasjids.com ·
**Deployed release:** `863e064` (`main`, CI run 42638983698 green incl. "Release to staging"; live 9 Nov 2026 ~21:10 IST — both `/health` report `863e064`, db + redis ok; migrations 0013–0017 applied by the deploy)

## 1. Summary

When a masjid admin publishes with **Notify followers** on, every phone that follows that masjid gets a notification:
- only phones that turned notifications on and did not mute the masjid
- only the right audience (brothers / sisters / everyone)
- written in each phone's own language
- tapping it opens that exact post

Each masjid has 8 notifying posts per day. The count resets at midnight in India, and the admin sees what is left
before publishing ("Will notify 12 people · 7 of 8 left today") and a history of what was sent. The Super Admin can
pause all notifications at once. Waiting notifications go out on Resume, and none are lost. Dead subscriptions are
removed by themselves. In the load test, 50,000 phones were notified in 57 seconds.

## 2. Tasks

| Task | Status | Key files | Tests / evidence |
|---|---|---|---|
| T4.1 Push infrastructure | ✅ | `packages/api/src/push/sender.ts`, `queue/`, `jobs/worker.ts` | classifier, headers + body decrypted as a browser would, allow-list property test, payloads refused at enqueue **and** at process time (#138) |
| T4.2 Musalli subscription UX | ✅ (real phones: O38) | `apps/app/src/lib/push.ts`, `features/settings/NotificationsScreen.tsx`, `PushAskSheet.tsx` | unit 13 (mocked PushManager, 409 re-subscribe); e2e Settings → on, soft-ask, A15 on / off / blocked / install-first, onboarding page 7 — ×4 locales, axe + screenshots |
| T4.3 Service worker push | ✅ | `apps/app/src/sw/push.ts` | 17 SW unit tests (valid / invalid payload, click routing); e2e: a captured payload delivered through CDP shows the Telugu notification that opens the notice |
| T4.4 Fan-out pipeline | ✅ | `jobs/processors/`, migrations 0016–0017, outbox sweeper | `push-pipeline.int.test.ts`: audiences, mute, push status, locale groups, pruning, retried batch / duplicate fan-out send nothing twice, Redis flushed → sweeper delivers once, brothers-only, dead statuses; route-table test (no route triggers a job); journeys 6/7/8 assert job + captured push |
| T4.5 Quotas & admin visibility | ✅ | `packages/db/src/repos/notifications.ts`, `routes/notifications.tsx`, Publish bar | IST-midnight reset (clock-controlled), counts match DB (integration), "Will notify N" = DB reach (e2e journey 7) |
| T4.6 Admin push & alerts | ✅ code · ⏳ owner check | `PUT/DELETE /auth/push`, alert service, admin SW | alert service integration; admin SW 10 unit tests; `use-alerts` unit (enable / disable / 409 / sign-out). **Acceptance (test alert on staging) = owner check 4.12 (O38)** |
| T4.7 Kill switch | ✅ | `POST /settings/push-pause`, C10 switch, C1 banner | integration: paused → zero sends, resume → same job continues; paused past the stuck window → not failed (#142 M1); e2e: published while paused waits, goes out after Resume; C1 banner screenshot |
| T4.8 Load test | ✅ | `scripts/load/push-load.ts`, `push-worker.ts` | table below and `docs/reports/evidence/PHASE_04_T4.8_push-load.md` |
| T4.9 Quality gates | _see §3_ | — | — |

### T4.8 load test (the worker in its own process; every send really encrypted and signed)

| Measure | 50,000 phones | 100,000 phones | Limit |
|---|---|---|---|
| Total dispatch time | **57.3 s** | 112.4 s | < 3 min ✅ |
| Send batches (max duration) | 200 (2.0 s) | 400 | < 240 s each ✅ |
| Worker CPU time | 26.7 s | 50.6 s | < 0.75 CPU ✅ |
| Worker peak memory (RSS / heap) | 409 / 228 MB | 404 / 238 MB | < 512 MB ✅ |
| Targeted / sent / pruned | 50,000 / 49,753 / 247 | — | 0.5 % dead on purpose |

Time grows with the audience; memory does not (it is bounded by the batches in flight), so the 512 MB worker limit
holds for any masjid size.

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format / i18n | ✅ | 0 warnings |
| Unit + component (coverage gates) | ✅ | **1,542** on 9 Nov 2026: app 196, admin 143, ui 310, i18n 199, domain 192 (100 %), shared 193, api 181, config 68, db 30, server 30 |
| DB policy matrix / privileges / explain | ✅ | db int **310** (lines 97.0 %) — #142 |
| API integration | ✅ | **345** + the #143 tests (branches 85.3 %) |
| DB privileges on staging Atlas | ⏳ | after the deploy (`pnpm db:verify-roles`) |
| Security scans | ✅ | gitleaks, osv-scanner, `pnpm audit`, Semgrep, hadolint, Trivy — two distroless zlib CVEs our process never loads ignored until 15 Nov 2026 (owner, #141, F61) |
| E2E (Pixel 7 / iPhone 14 / push project) | _CI on HEAD_ | push project 13/13 locally |
| Accessibility (axe) | ✅ | every new screen axe-clean in 4 locales |
| Visual regression | ✅ | 16 screens × 4 locales × 2 phones; Settings baselines updated for the Notifications row |
| Bundle budgets | ✅ | musalli initial JS 187.65 / 188 kB gz (subscription code lazy-loaded) |
| Lighthouse (mobile) | ✅ | CI: cold musalli LCP 2485 ms; warm within the 2-point tolerance (#142) |
| Load test | ✅ | §2 |
| phase-verifier | fixed | FAIL → fixed (#143) |
| security-reviewer | 0 HIGH / 0 MEDIUM open | first review: 3 MEDIUM fixed, LOW fixed or tracked (#142); re-review of the fixes: 1 MEDIUM + 6 LOW, all fixed (#144) |

## 4. Screenshots

In the CI Playwright report, each axe-checked, in en / hi / ur / te:
- musalli: soft-ask sheet, Settings → Notifications (on / off / blocked / install-first), onboarding page 7, Settings
  with the Notifications row (visual baselines)
- admin: `b3-notifications` (history), Publish bar with "Will notify N"
- Super Admin: C1 with the paused banner, C10 switch

Urdu is mirrored.

## 5. Deviations from spec

- **Real push-service delivery is not in e2e** (#139). Headless browsers cannot subscribe at FCM / APNs, and tests must not
  send traffic to Google. The test stack's worker records each push instead (it really encrypts it), and the test
  hands it to the real service worker. Real phones: owner check O38.
- **No `Topic` header** (your choice, #142 M3). It travels to Google / Apple unencrypted and would reveal which masjid
  a phone follows. The phone still replaces an earlier notification of the same post.
- **Push stats on C1, not C12** (#143). C12 is a Phase 9 screen.
- **Musalli initial JS 187.65 kB.** This is over the original 170 kB target but within your 188 kB limit (#140, your
  rule on small overruns).

## 6. Known limitations / follow-ups

All deferred with a DECISIONS entry:
- **F61** — the Trivy ignore expires 15 Nov 2026. Move to the fixed distroless image before then.
- **F62** — a timed-out batch keeps running. At most one duplicate buzz, which the phone collapses (Phase 9).
- **F63** — the push service's `Retry-After` is not honoured beyond the normal backoff (before the pilot).
- **F64** — a pause takes effect per batch, so up to ~4,000 sends can still go out after you press Pause (Phase 8).
- **F65** — signing out one admin device, or a session expiring, does not stop that phone's alerts. "Sign out
  everywhere", a recovery and a revoke by you do stop them. Masjid admins get only test alerts today, so this is
  planned before Phase 5's first real alert to them (#144).
- **F60** — `web-push` 3.6.7 → 4.x after its changelog review (Phase 9).

## 7. What the owner should test now

`owner/PHASE_TESTING_GUIDE.md` → Phase 04, checks 4.1–4.12.

Before you start:
- **O37** — notification keys on staging.
- Phones: Android A + iPhone as musallis (the iPhone only as the installed Home Screen app), Android B as admin.
- Seed follow codes: **TESTA001**, **TESTB002**, **TESTC003**.
- Check 4.12 sends a test alert from Super Admin → Settings. The button exists only outside production.
