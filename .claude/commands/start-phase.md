---
description: Start (or resume) a Masjid Connect build phase
argument-hint: <phase number, e.g. 03>
---

Start or resume **Phase $ARGUMENTS**.

1. Follow the "Session start protocol" in `CLAUDE.md §3`.
2. Confirm in `docs/PROGRESS.md` that every earlier phase is `DONE` (owner-verified). If not, stop and tell me which phase is pending.
3. Read `docs/phases/PHASE_$ARGUMENTS_*.md` and every doc in its "Read before starting" list.
4. Check `docs/DECISIONS.md` for OPEN items affecting this phase. If any, ask me before starting the affected tasks.
5. Set the phase status to `IN PROGRESS` in `docs/PROGRESS.md`.
6. Give me a 5–10 line plan: task order, anything you need from me (accounts, keys, content), risks.
7. Then start with the first unchecked task and follow `CLAUDE.md §4` for each task. Keep going task by task until the phase is complete or you hit a STOP condition.
