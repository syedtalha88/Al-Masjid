# PHASE 05 REPORT — Donations, chanda & UPI change-lock

> **Status: DRAFT — T5.7 (quality gates) in progress.** Not deployed. Phase 05 goes to staging only after Phases 03 + 04
> are verified, or with the owner's OK, and after **O43** (Atlas roles) — DECISIONS #145.
>
> What the owner should know first:
> - Three security decisions are waiting for you (**O46**, DECISIONS #160). The phase's own exit rule says "no
>   security finding of any severity on the UPI change-lock"; two of the open items (L2, L5) are on that path, so
>   the phase closes after your answers.
> - A real ₹1 payment from Donate Now and from a saved QR, on Android and iPhone, is yours (**O28** + guide checks
>   5.5–5.7) — test browsers have no UPI app.

**Date:** 12 Nov 2026 · **Commit range:** `863e064..feat/phase-05` (57 commits, started 9 Nov 2026 — #145) ·
**Staging:** not deployed (release `13d1031` / Phases 03 + 04 there) · **CI:** `ci/phase-05` = `d3c4379`, run in
progress at this draft.

## 1. Summary

A masjid admin asks for the masjid's UPI details (B8, typed or scanned from the masjid's own UPI QR); the Super Admin
checks them in C4 and approves with a fresh passkey step-up; they go live only after a 24-hour hold, and every
follower is told with a locked, important notice. Nobody — not even a hijacked admin session — can change what
followers pay to any other way (security review: no bypass found). On that basis masjids run up to three donation
drives (live progress, "Received (reported by masjid)", Donate Now opens the phone's UPI app, Show / Save UPI QR),
publish weekly chanda with a chart only when they choose to, and list needy people they have verified (consent
required, private phone / note encrypted, paid directly by UPI, gone when fulfilled, deleted after 90 days). Musallis
keep a personal zakat tracker that never leaves the phone.

## 2. Tasks

| Task | Status | Key files | Tests |
|---|---|---|---|
| T5.1 UPI domain module | ✅ | `packages/domain/src/upi.ts` | `domain/test/upi.test.ts` (100 %, fast-check round trip, injection cases; + `mentionsPaymentAddress` #160) |
| T5.2 Payment profile workflow (R1) | ✅ | `db/src/state/payment.ts`, `api/src/routes/payments.ts`, worker `payment-activate`, admin `/payment`, `/super/payments` | db `payment.int` 16, api `payment-routes.int`, e2e `payment.spec.ts` (journey 9 part 2: +23 h old, +24 h new + notice) |
| T5.3 Campaigns (admin) | ✅ | `db/src/state/campaigns.ts`, `/donation`, `/donation/new`, worker `campaign-close` | db `campaigns.int`, api `campaign-routes.int`, DB privilege (history append-only) |
| T5.4 Campaigns (musalli) | ✅ | `apps/app/src/features/campaigns/*` | e2e `campaigns.spec.ts` (exact `upi://` link intercepted, disclaimer ×4), visual baselines |
| T5.5 Chanda | ✅ | `db/src/state/chanda.ts`, B9 `/chanda`, A11 + `ChandaChart` | db `chanda` + view tests (hidden never public), chart 0–8 weeks, e2e `chanda.spec.ts` |
| T5.6 Integration polish | ✅ | Updates chips, push texts, Super stats | visual baselines updated (#154) |
| T5.8 Needy people | ✅ | `db/src/state/beneficiary.ts`, B19 `/needy`, A23 | db `beneficiaries.int` 19, api `beneficiary-routes.int` (private part in no public response), e2e `needy.spec.ts` |
| T5.9 My zakat | ✅ | `apps/app/src/features/zakat/*`, device document `zakat` | `zakat.test.ts` 12, e2e `zakat.spec.ts` (network assertion, Clear all data, 4 locales) |
| T5.7 Quality gates | ⏳ | `e2e/admin/screens.spec.ts` (Phase 05 screens ×4) | see §3 — open: `pnpm verify`, phase-verifier, owner O46 |

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ local | 0 warnings |
| Unit + component | ✅ local | app 228 · admin 166 · ui 332 · i18n 206 · domain 220 (100 % gate) |
| DB policy matrix + privileges | ✅ local | `pnpm db:test` 371 |
| API integration | ✅ local | 372 |
| E2E (Pixel 7, local) | ✅ | admin screens ×4 locales, zakat 6, campaigns, needy, voice, payment (journey 9 part 2) — CI (Pixel 7 + iPhone 14) pending |
| Accessibility (axe) | ✅ | every Phase 05 screen in en / hi / ur / te: 0 violations |
| Visual regression | ✅ | `pnpm test:visual` 24/24 (key screens × 4 locales × 2 phones) |
| Bundle budgets | ✅ | app initial JS 188.7 / 189 kB (raised 188 → 189, #157 — owner rule "quality over budgets"); QR generator lazy |
| Lighthouse / motion | ⏳ | CI |
| phase-verifier | ⏳ | running |
| security-reviewer | 0 HIGH · 4 MEDIUM (3 fixed, 1 half) · 11 LOW | DECISIONS #160 — see §6 |

## 4. Screenshots

`e2e/admin/screens.spec.ts` attaches, per locale (en / hi / ur / te): `b8-payment-setup`, `b8-payment-waiting`,
`b8-donation-no-upi`, `b9-chanda-empty`, `b19-needy-empty`, `c1-dashboard-requests`, `c4-payments`,
`c4-payments-on-hold`, and with Delta's data `b8-payment-change`, `b8-donation`, `b8-donation-update`,
`b8-donation-new`, `b9-chanda`, `b19-needy`, `b19-needy-received`, `b19-needy-new`. Musalli: visual baselines
`campaigns`, `campaign-detail`, `donations-*`, `weekly-chanda`, `help-the-needy`, `settings` (× 4 × 2); zakat and needy
sheets in their e2e attachments.

**A10 vs `ref-3` screen 13 (T5.4 acceptance):** same structure — hero with the status pill, title, amount with goal,
progress bar with %, Started / Ends / purpose row, About, Donate Now, Show UPI QR Code, the footer note. Intended
differences: the seed drive has no cover photo (mint placeholder); "Received (reported by masjid)" and a "Last updated
… by masjid admin" line (05 §8 wording); a heart on Donate Now instead of a UPI-app logo (no brand logos).

## 5. Deviations from spec

- Chanda chart in HTML bars instead of SVG (#152) · payee QR scan Android-only, admin CSP unchanged (#147) · journey 9
  part 2 runs the activation through a test hook on api-admin's settable clock (#151) · needy consent missing → 400,
  not 422 (#156) · "Log this in My zakat?" asked only for zakat-eligible people (#158 — owner may widen, O44) · Super
  Admin alerts reach the phone 30 days after the last use, admins' end with the session (#159, O44) · the needy list is
  cached one day, not immutable (#160).

## 6. Known limitations / follow-ups

From the security review (#160), not fixed in this phase: **F67** CDN purge when a needy person leaves (Phase 8) ·
**F68** refuse photos that contain a QR code (owner, O46) · **F69** UPI requests by owners only, all owners alerted,
open requests rejected when their admin is revoked (owner, O46) · **F70** live UPI details writable only by the worker,
needy ciphertext bound to the person, lint rule for raw reads (Phase 9). L10 / L11 (consent detail, phone-number UPI
IDs) go to the lawyer review (O34).

## 7. What the owner should test now

After deployment: `owner/PHASE_TESTING_GUIDE.md` → Phase 05 (5.1–5.20). Seed masjid **TESTD004** (Test Masjid Delta)
has drives, chanda and four needy people with fake UPI IDs (`@okexample`) — never pay to them; use your own UPI ID
(O28) for the ₹1 test.
