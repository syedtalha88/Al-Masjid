# PHASE 05 — Donations, Chanda & UPI Change-Lock

## Goal
Masjids can run transparent donation drives and show weekly chanda; musallis donate in one tap through any UPI app (or the QR) directly to the masjid's **verified** UPI account; and no one — not even a compromised admin account — can silently redirect donations.

## Read before starting
`CLAUDE.md` · `00_PRODUCT_SPEC.md` §4.3 (Donation campaigns, Weekly chanda) · `01_ARCHITECTURE.md` §5.7 (upi, money) · `02_DATA_MODEL.md` (payment_profiles + state machine, campaigns, campaign_amount_history, chanda_weeks) · `03_API_SPEC.md` (Campaigns, Chanda, Payment, Super Payments, jobs payment-activate & campaign-close) · `04_SECURITY.md` §2 R1, §6 · `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §8 · `06_DESIGN_SYSTEM.md` (ProgressBar, AmountPair, MetaRow, QrCodeView, ChandaChart) · `07_SCREEN_SPECS.md` A10, A11, B8, B9, C4 · `08_MOTION.md` §5.7 · **ref-2/3 and ref-3/4**.

## Owner prerequisites
- A real masjid (or the owner's own) UPI ID for a ₹1 end-to-end test on staging. **Strong recommendation for real masjids: a merchant/business UPI ID** (from a bank current account or a free business-UPI app), because some UPI apps restrict or warn on intent-based payments to personal UPI IDs. The QR path works regardless.

## Out of scope
Any payment processing, payment confirmation/reconciliation, receipts, 80G.

---

## Tasks

### T5.1 — UPI domain module (test-first)
**Do:** `packages/domain/upi`: `isValidVpa` (02 regex + length), `normalizeVpa` (trim, lowercase handle), `buildUpiUri({vpa, payeeName, note})` → `upi://pay?pa=…&pn=…&tn=…&cu=INR` (RFC 3986 percent-encoding; payee name ≤ 50 chars and note ≤ 50 chars; non-ASCII characters are kept as UTF-8 percent-encoded, never transliterated; behaviour with real UPI apps is verified in the owner guide), `parseUpiUri(string)` (accepts `upi://pay` only; extracts `pa`, `pn`; ignores `am`, `mc` etc.), money formatting already in `money`.
**Acceptance:** [ ] 100% coverage; fast-check round-trip `parse(build(x)) ⊇ x`; malicious inputs (`&am=`, newline injection, `javascript:`) neutralized.

### T5.2 — Payment profile workflow (R1)
**Do:** Implement the state functions `requestPaymentChange`, `approvePaymentChange`, `rejectPaymentChange`, `activateDuePaymentProfiles` in `packages/db/src/state/payment.ts` (replace stubs; each in one transaction with audit + version bump; `open` flag and partial unique indexes per 02). API: admin `GET /payment`, `POST /payment/requests`; super `GET /payments/pending`, ★`POST /payments/:id/approve`, `POST /payments/:id/reject`; BullMQ job scheduler `payment-activate` every 10 min (worker). The hold period is env-configurable (`PAYMENT_HOLD_MINUTES`, default 1440) so the owner can test on staging with e.g. 15 minutes; **production boot assertion refuses any value below 1440**. On activation: previous active → superseded; version bump; create a `timing_update`-style system notice item "Payment details updated" (new item type not needed — use an announcement with system template `payment_details_updated`, category general, important) and enqueue push (bypasses quota). Alerts: Super Admin push on new request; requesting admin push on approve/reject/activation. Admin UI (B8 "UPI setup / change"): scan existing UPI QR with camera (reuse scanner, `parseUpiUri`), or type VPA; payee name; note; status timeline. Super UI (C4) with side-by-side diff + checklist + ★approve.
**Acceptance:** [ ] Policy-matrix + data-layer tests: only super admin can approve; there is no repository path for an admin to write `payment_profiles` except `requestPaymentChange`; only one active/pending per masjid (unique-index test with concurrent requests); activation only after `effective_at`. [ ] E2E journey 9 part 2 with clock control: request → approve → +23h still old → +24h new active → followers' bundle shows new VPA + "changed" notice. [ ] Security-reviewer specifically re-checks R1.

### T5.3 — Campaigns (admin)
**Do:** API: create (requires active payment profile + undertaking), patch (title/description/cover/end date only; target change allowed only upward and audited), `POST /received` (amount history row, version bump, optional notify default off), complete. Jobs: `campaign-close` daily (worker scheduler, 00:10 IST). Admin UI B8 (list, create flow with purpose cards + templates, NumberPad, cover upload with ownership checkbox, update amount sheet with live %).
**Acceptance:** [ ] Max 3 active per masjid. [ ] Amount history append-only (DB-privilege test: `mc_admin` update/delete → `Unauthorized`). [ ] Integration tests for all validation rules.

### T5.4 — Campaigns (musalli)
**Do:** A10 list + detail exactly per spec and refs (hero, status pill, AmountPair with "Received (reported by masjid)", ProgressBar fill-on-view, count-up, last updated line, MetaRow, About, Donate Now, Show UPI QR Code sheet with payee/VPA copy/QR/Save QR/hints/"changed recently" notice, footer disclaimer, closed state). Donate Now → `buildUpiUri`; fallback to QR sheet when no handler (desktop) — detect via `visibilitychange` not firing within 1.5 s → show sheet. Save QR: render QR SVG → canvas → PNG (iOS: Web Share with file; Android: download). Masjid Detail row + Home/Updates entries for campaigns.
**Acceptance:** [ ] Visual match vs ref-3/4 + ref-2/3 (report side-by-side). [ ] E2E: Donate Now navigates to exact expected `upi://` URI (intercepted). [ ] Disclaimer present in all 4 locales.

### T5.5 — Chanda
**Do:** Admin B9 (week selector with configurable week start, NumberPad, note, show toggle with explanation, notify default off, history). API per 03. Musalli A11 with ChandaChart (custom SVG, mirrored in RTL per 09 §5), Masjid Detail row only when shown, `chanda_update` feed items.
**Acceptance:** [ ] Hidden chanda never returned by public API (integration test + `v_pub_chanda_weeks` view test; `setShowChanda` mirror test). [ ] Chart renders 0–8 weeks gracefully.

### T5.6 — Integration polish
**Do:** Updates chips gain Donations/Chanda; unseen counts; push texts for campaign create/update and chanda (localized); Super Admin Stats show active campaigns count.
**Acceptance:** [ ] Visual baselines updated for all affected screens.

### T5.7 — Quality gates
**Do:** Full e2e journey 9; budgets (QR generator code lazy); axe; security-reviewer focus on payment flow.
**Acceptance:** [ ] All green.

---

## Phase exit criteria
Owner completes a real ₹1 UPI payment on Android and iPhone from Donate Now and from the saved QR (owner guide Phase 05); change-lock verified; phase-verifier PASS; security-reviewer clean (no findings at any severity on R1 paths).
