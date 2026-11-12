# PHASE 05 REPORT — Donations, chanda & UPI change-lock

> **Status: FINAL — DONE on our side, owner checks pending (DECISIONS #162).** Not deployed: Phases 05 + 06 reach
> staging when they are merged into `main`, which waits for **O43** (Atlas roles — the needy-people collections need
> them; `main` deploys to staging automatically). Then O45, guide checks 5.1–5.22 and the ₹1 UPI test (O50, O28).
>
> What the owner should know first:
> - Your security decisions (O46) are answered — yes to all (DECISIONS #161): UPI changes by owners only with every
>   owner alerted is built and re-reviewed (F69); QR-in-photo refusal comes with Phase 8 moderation (F68); worker-only
>   live UPI details with Phase 9 hardening (F70).
> - A real ₹1 payment from Donate Now and from a saved QR, on Android and iPhone, is yours (O28) — test browsers have
>   no UPI app.

**Date:** 13 Nov 2026 · **Commits:** `863e064..feat/phase-05` (`997a914`) plus the close-out fixes on `feat/phase-06`
(Urdu baselines, C4 history, owner-only e2e, sign-out-everywhere) · **Staging:** not deployed (O43) · **CI:** run
43134964131 on `997a914` — every job green (typecheck · lint · format · i18n; unit + coverage gates; integration +
db tests; security scans; build · budgets · images · e2e Pixel 7 + iPhone 14 · admin e2e · motion perf · Lighthouse
· visual).

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
| T5.7 Quality gates | ✅ | `e2e/admin/screens.spec.ts` (Phase 05 screens ×4), `e2e/admin/payment-owners.spec.ts` | §3 |

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅ local | 0 warnings |
| Unit + component | ✅ local | app 228 · admin 166 · ui 332 · i18n 206 · domain 220 (100 % gate) |
| DB policy matrix + privileges | ✅ local + CI | `pnpm db:test` 376; `db:schema:check` ✅ on a database at 0022 |
| API integration | ✅ local | 372 |
| E2E (Pixel 7, local, 12 Nov) | ✅ | admin screens ×4 locales, zakat 6, campaigns, needy (25/25); journey 9 part 2 (`payment.spec.ts`) re-run after #160 — see the T5.7 checklist; iPhone 14 / WebKit only on CI (pending) |
| Accessibility (axe) | ✅ | every Phase 05 screen in en / hi / ur / te: 0 violations |
| Visual regression | ✅ | `pnpm test:visual` 24/24; Urdu baselines re-taken 13 Nov (₹ now before the digits) — #160's "baselines unchanged" was wrong |
| Bundle budgets | ✅ | app initial JS 188.7 / 189 kB (raised 188 → 189, #157 — owner rule "quality over budgets"); QR generator lazy |
| Lighthouse / motion | ✅ CI | run 43134964131 (local runs on this PC miss the cold-LCP budget by ~0.35 s — CI is the gate) |
| phase-verifier | ✅ after fixes (13 Nov) | 12 Nov FAIL → fixed (Urdu time, journey 9, report). 13 Nov FAIL on: stale Urdu visual baselines (they still showed "12,500₹" — the 0.2 % pixel threshold could not see the moved sign; re-taken and checked by eye), C4 history missing (built), no test for the B8 editor view / stopped request (e2e `payment-owners.spec.ts` + screenshots), `db:schema:check` (✅ on 0022), report + owner list (done) |
| security-reviewer | ✅ | #160: 0 HIGH · 4 MEDIUM (fixed) · 11 LOW; #161 re-review of R1: 0 HIGH · 0 MEDIUM · 3 LOW + nit, all fixed — see §6 for the LOWs kept |

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
- UPI change requests by masjid **owners** only, every owner alerted, a request stops with its admin (#161) — beyond
  the phase file, the owner's choice.
- C4 shows the masjid's last 5 earlier / refused UPI details as its "history" (07 C4) — added at close-out.

## 6. Known limitations / follow-ups

**LOW findings kept on R1 paths (accepted risk, with reasons):** L4 (#160) — the Super Admin's request alert is
best-effort; C1 lists every open change request, so a lost alert never hides one. L7 — the needy-person ciphertext's
associated data does not name the person; only a database-level writer could swap two ciphertexts of the same masjid,
and that writer could change far more (F70, Phase 9). L9 — one raw read in `repos/beneficiaries.ts` (own masjid
checked, `_id` only); the lint rule against raw reads comes with F70. L5 — `mc_admin` can technically write
`payment_profiles`; the worker-only live-details collection is F70 (owner-accepted for Phase 9).

From the security review (#160), not fixed in this phase: **F67** CDN purge when a needy person leaves (Phase 8) ·
**F68** refuse photos that contain a QR code (accepted, Phase 8 with moderation) · **F70** live UPI details writable
only by the worker,
needy ciphertext bound to the person, lint rule for raw reads (Phase 9). L10 / L11 (consent detail, phone-number UPI
IDs) go to the lawyer review (O34).

## 7. What the owner should test now

After deployment: `owner/PHASE_TESTING_GUIDE.md` → Phase 05 (5.1–5.20). Seed masjid **TESTD004** (Test Masjid Delta)
has drives, chanda and four needy people with fake UPI IDs (`@okexample`) — never pay to them; use your own UPI ID
(O28) for the ₹1 test.
