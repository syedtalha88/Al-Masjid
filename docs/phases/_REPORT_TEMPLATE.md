# PHASE XX REPORT — <title>

**Date:** · **Commit range:** `<from>..<to>` · **Staging URLs:** app: … · admin: … · **Deployed image digests:** api/worker: …

## 1. Summary
2–5 sentences: what now works end-to-end.

## 2. Tasks
| Task | Status | Key files | Tests |
|---|---|---|---|

## 3. Verification results
| Gate | Result | Numbers |
|---|---|---|
| Typecheck / lint / format | ✅/❌ | warnings: 0 |
| Unit + component | | N tests, coverage per package |
| DB policy matrix | | N tests, matrix cells covered N/N |
| DB privileges (local / staging Atlas) | | N checks, all forbidden ops → Unauthorized |
| Infra (Trivy / `infra/vps/check.sh`) | | high/critical: 0 · checklist PASS N/N |
| API integration | | N tests |
| E2E (Pixel 7 / iPhone 14) | | N specs, flaky: 0 |
| Accessibility (axe) | | serious/critical: 0 |
| Visual regression | | screens × locales |
| Bundle budgets | | app initial JS __ KB gz (≤170), largest lazy chunk __ KB |
| Lighthouse (mobile) | | Perf __ / A11y __ / BP __ ; LCP __ s; CLS __ |
| Motion perf traces | | long tasks > 50 ms: 0; dropped frames __% |
| phase-verifier | PASS | link to output |
| security-reviewer | 0 HIGH / 0 MEDIUM | LOW items + justification |

## 4. Screenshots
List of generated screenshots (paths) for new screens in en / hi / ur / te, and a one-line comparison note against `docs/design-references`.

## 5. Deviations from spec
Each with DECISIONS link and reason.

## 6. Known limitations / follow-ups
Must be empty or explicitly deferred with a DECISIONS entry.

## 7. What the owner should test now
Pointer to `owner/PHASE_TESTING_GUIDE.md → Phase XX`, plus: test credentials / invite links / seed data notes, and anything that changed from the guide.
