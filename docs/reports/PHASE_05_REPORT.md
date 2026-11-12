# PHASE 05 REPORT — Donations, chanda & UPI change-lock

> **Status: DRAFT — T5.7 (quality gates) in progress.** Not deployed. Phase 05 goes to staging only after Phases 03 + 04
> are verified, or with the owner's OK, and after **O43** (Atlas roles) — DECISIONS #145.
>
> What the owner should know first:
> - Your security decisions (O46) are answered — yes to all (DECISIONS #161): UPI changes by owners only with every
>   owner alerted is built (F69); QR-in-photo refusal comes with Phase 8 moderation (F68); worker-only live UPI details
>   with Phase 9 hardening (F70).
> - Per your rule of 12 Nov (DECISIONS #162) the phase closes when our checks pass; your manual checks are listed in
>   `owner/MY_PENDING_TASKS.md`.
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
| E2E (Pixel 7, local, 12 Nov) | ✅ | admin screens ×4 locales, zakat 6, campaigns, needy (25/25); journey 9 part 2 (`payment.spec.ts`) re-run after #160 — see the T5.7 checklist; iPhone 14 / WebKit only on CI (pending) |
| Accessibility (axe) | ✅ | every Phase 05 screen in en / hi / ur / te: 0 violations |
| Visual regression | ✅ | `pnpm test:visual` 24/24 (key screens × 4 locales × 2 phones) |
| Bundle budgets | ✅ | app initial JS 188.7 / 189 kB (raised 188 → 189, #157 — owner rule "quality over budgets"); QR generator lazy |
| Lighthouse / motion | ⏳ | CI |
| phase-verifier | ❌ → fixing (12 Nov) | FAIL on: T5.7 open, journey 9 stale after #160, Urdu time "AM 1:24" on C4 / B8 (fixed: LTR isolate + unit test), T5.4 evidence (now §4), report gaps (fixed). Open: `pnpm verify`, CI, owner O28 / O46 |
| security-reviewer | 0 HIGH · 4 MEDIUM (3 fixed, 1 half) · 11 LOW | DECISIONS #160 — see §6 |

## 4. Screenshots

`e2e/admin/screens.spec.ts` attaches, per locale (en / hi / ur / te): `b8-payment-setup`, `b8-payment-waiting`,
`b8-donation-no-upi`, `b9-chanda-empty`, `b19-needy-empty`, `c1-dashboard-requests`, `c4-payments`,
`c4-payments-on-hold`, and with Delta's data `b8-payment-change`, `b8-donation`, `b8-donation-update`,
`b8-donation-new`, `b9-chanda`, `b19-needy`, `b19-needy-received`, `b19-needy-new`. Musalli: visual baselines
`campaigns`, `campaign-detail`, `donations-*`, `weekly-chanda`, `help-the-needy`, `settings` (× 4 × 2); zakat and needy
sheets in their e2e attachments.

**A10 vs the references (T5.4 acceptance — written comparison; the images are `docs/design-references/ref-2…png`
screen 12, `ref-3…png` screen 13 and `e2e/visual/__screenshots__/visual-pixel-7/en/campaign-detail.png`):**
- *ref-3 screen 13:* same structure — hero with the status pill, title, amount with goal, progress bar with %,
  Started / Ends / purpose row, About, Donate Now, Show UPI QR Code, the footer note.
- *ref-2 screen 12:* same amount block ("Received (reported by masjid)" / target, % bar) and the same "Last updated …
  by masjid admin" box and About section.
- Differences: the seed drive has no cover photo (mint placeholder); a heart on Donate Now instead of a UPI-app logo,
  and no Google Pay / PhonePe / Paytm logos (no brand logos); **ref-2's inline "Donate via UPI" block (QR + "Open UPI
  App") is not on the page** — 07 A10 specifies Donate Now plus a "Show UPI QR Code" sheet (payee, UPI ID copy, Save
  QR, hints), which is what is built (§5).

## 5. Deviations from spec

- A10: ref-2's inline QR block → the "Show UPI QR Code" sheet of 07 A10 (spec over picture); no UPI-app logos.
- `lean-qr` instead of the unmaintained `qrcode` package for the UPI QR (#149).
- The Super Admin may also stop a change **during** the hold (reject from `approved_on_hold`, #146) — 02's state
  diagram had reject from `pending` only.
- Chanda chart in HTML bars instead of SVG (#152); admin screens (B8, B9, B19, C1, C4) have 4-locale screenshots,
  not pixel baselines (#154).
- Payee QR scan Android-only, admin CSP unchanged (#147, owner).
- Journey 9 part 2 runs the activation through a test hook on api-admin's settable clock (#151).
- Needy consent missing → **400**, not 422 as the phase file says — 03 §0 uses 400 for every validation failure
  (#156; acknowledged by the owner, #161).
- UPI change requests by masjid **owners** only (editors get `PAYMENT_OWNER_ONLY`); every owner is alerted; removing
  or revoking the requester closes the request (#161, F69 — review L2 / L3).
- Needy UPI changes (04 R13): recorded old → new in the person's history, the audit says only "changed" (#160 M3).
- The public needy list is cached one day, not immutable (#160 M4).
- "Log this in My zakat?" only for zakat-eligible people (#158, O44); Super Admin alerts reach the phone for 30 days
  after its last use, admins' end with the session (#159, O44).
- App initial JS budget 188.7 / **189 kB** (raised during this phase, #157; 01 §9's original target is 170 kB).

## 6. Known limitations / follow-ups

From the security review (#160), not fixed in this phase: **F67** CDN purge when a needy person leaves (Phase 8) ·
**F68** refuse photos that contain a QR code (accepted, Phase 8 with moderation) · **F70** live UPI details writable
only by the worker,
needy ciphertext bound to the person, lint rule for raw reads (Phase 9). L10 / L11 (consent detail, phone-number UPI
IDs) go to the lawyer review (O34).

## 7. What the owner should test now

After deployment: `owner/PHASE_TESTING_GUIDE.md` → Phase 05 (5.1–5.20). Seed masjid **TESTD004** (Test Masjid Delta)
has drives, chanda and four needy people with fake UPI IDs (`@okexample`) — never pay to them; use your own UPI ID
(O28) for the ₹1 test.
