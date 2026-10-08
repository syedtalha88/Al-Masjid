---
description: Run the full completion protocol for a Masjid Connect phase
argument-hint: <phase number, e.g. 03>
---

Finish **Phase $ARGUMENTS** using `CLAUDE.md §5`:

1. Confirm every task in `docs/phases/PHASE_$ARGUMENTS_*.md` is ticked in `docs/PROGRESS.md`. If not, list what's left and stop.
2. Run `pnpm verify`. Fix failures until green.
3. Use the `phase-verifier` subagent for Phase $ARGUMENTS. Fix every required fix, then re-run it until it reports PASS.
4. Use the `security-reviewer` subagent on this phase's changes. Fix all HIGH and MEDIUM findings; re-run until none remain.
5. Deploy to the staging VPS (`deploy-staging` workflow), confirm both staging URLs load on a mobile viewport through Cloudflare and the health endpoints are green.
6. Write `docs/reports/PHASE_$ARGUMENTS_REPORT.md` from `docs/phases/_REPORT_TEMPLATE.md`.
7. Set status to `AWAITING OWNER VERIFICATION` and tell me exactly which section of `owner/PHASE_TESTING_GUIDE.md` to run, plus the preview URL and any test credentials/invite links I need.
