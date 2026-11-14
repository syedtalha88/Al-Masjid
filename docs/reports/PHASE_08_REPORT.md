# PHASE 08 REPORT — Moderation, grievance, legal pages, QR posters

> **Status: FINAL — DONE, owner checks pending** (DECISIONS #162, #182). Closed with the bare minimum on the owner's
> instruction (14 Nov 2026); the optional items are deferred to Phase 9 (list in §6). The owner checks O51, O53–O59
> after Phase 08 is on staging.

**Date:** 14 Nov 2026 · **Commits:** `046317f..` on `feat/phase-08` (on top of Phases 05–07) · **Staging:** with the
merge into `main` · **Decisions:** #170–#179 (T8.1–T8.10), #180 + #181 (security reviews), #182 (verifier fixes,
bare-minimum close).

## 1. Summary

Musallis can report any post or masjid ("…" → Report); urgent reports alert the Super Admin and enough distinct
reports auto-hide a post once. The Super Admin works a moderation queue (C5: remove / restore / dismiss with step-up,
template notices in 4 languages, CDN purge, media made private on removal), an SLA dashboard (C1 deadlines), a
grievance tracker (C6, contacts sealed in api-public and opened only in api-admin), a legal-orders register (C7,
encrypted documents, 3 h timer), kill switches and banners (C10), audit + stats (C11, C12) and printable QR posters
(C3, A4 / A5). Legal texts (privacy, terms, content policy, grievance) ship as drafts with re-acceptance; the
retention job covers every row of 02 §6.

## 2. Tasks

| Task | Status | Decisions | Tests (headline) |
|---|---|---|---|
| T8.1 Reporting | ✅ | #170 | db reports 8, api report routes 6 + triage 7, e2e report 7/7 both phones |
| T8.2 Moderation queue & takedown (C5) | ✅ | #171 | journey 11 (Pixel 7), media-access job, cdn-purge queue |
| T8.3 SLA engine & dashboard (C1) | ✅ | #172 | sla-alerts job, slaProgress unit |
| T8.4 Grievances (C6) | ✅ | #173 | seal / open, ticket numbers, routes |
| T8.5 Legal orders (C7) | ✅ | #174 | encrypted documents, timers, routes |
| T8.6 Legal texts & re-acceptance | ✅ | #175 | production build refuses drafts, re-accept flows |
| T8.7 Retention job | ✅ | #176 | every 02 §6 row, dry-run route tests (#182) |
| T8.8 QR poster (C3) | ✅ | #177 | e2e decodes the QR, one page per size |
| T8.9 Kill switches & banners | ✅ | #178 | 12 integration tests |
| T8.10 Audit & stats | ✅ | #179 | stats-snapshot job, audit meta allow-list |
| T8.11 Quality gates | ✅ | #180–#182 | see §3 |

## 3. Verification results

| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format / i18n | ✅ | CI `ci/phase-08`, 0 warnings |
| Unit + coverage gates | ✅ | CI |
| DB integration + policy matrix | ✅ | 445 tests, 96.48 % |
| API integration | ✅ | packages/api branch gate 85 % (CI) |
| E2E | ✅ | Phase 08 specs 18/18 Pixel 7; full suite in CI |
| Visual regression | ✅ | 54 shots (print-sheet baselines → Phase 9) |
| Bundle budgets | ✅ | app 193.6 / 195 kB, admin 218.8 / 220 kB |
| phase-verifier | FAIL → fixed | 9 REQUIRED fixed (#182); no second run (owner instruction) |
| security-reviewer | 0 HIGH / 0 open MEDIUM | #180 0H / 7M / 12L fixed; re-review #181 0H / 2M / 7L fixed (N-L4 accepted) |

## 4. Screenshots

`e2e/visual/__screenshots__/<locale>/`: report sheet (musalli, 4 locales × 2 devices), `admin-c3-poster`,
`admin-c5-reports`, `admin-c6-grievances`, `admin-c7-legal-orders`, `admin-c10-settings`, `admin-c12-stats` (Pixel 7 ×
4 locales).

## 5. Deviations from spec

- Staging CDN purge after takedown (F76) and the Cloudinary public-URL check for legal documents are owner checks O51 /
  O54 instead of automated checks (#182).
- F57 admin Home inbox banner → Phase 9 (#182).

## 6. Known limitations / follow-ups (deferred to Phase 9, DECISIONS #182)

Print-sheet visual baselines (A4 / A5); automated staging purge check; automated Cloudinary public-URL check; journey 11
through a real notification; C5 filters urgent / reports / legal; the C5 report-card language switch (Urdu check failed in CI, removed); illustrated empty states on C5 / C6 / C7; C1 / A5
screen baselines; legal gate vs `translation: draft`; dry-run counts for beneficiaries / alert subscriptions; admin
yearly re-accept e2e; a test for the VPS 200-day log check; a re-review of #181. Legal texts are drafts — production is
blocked until O55 (legal review + human translations).

## 7. What the owner should test now

`owner/PHASE_TESTING_GUIDE.md` → Phase 08, and in `owner/MY_PENDING_TASKS.md`: **O59** (re-apply Atlas roles — before
the merge reaches staging), **O53** (grievance key pair), then O51 (takedown), O54 (legal document), O56 (QR print +
scan), O57 (kill switches), O58 (stats).
