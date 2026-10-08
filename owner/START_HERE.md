# START HERE — How to build Masjid Connect with Claude Code

## 1. Set up the project folder
1. Create a new private GitHub repository (e.g. `masjid-connect`) and clone it to your computer.
2. Copy **everything from this pack** into the repository root, keeping the folders:
   ```
   CLAUDE.md
   .claude/            (settings.json, agents/, commands/)
   docs/               (specs, phases, design-references, PROGRESS.md, DECISIONS.md)
   owner/              (these files — for you)
   ```
3. Commit: `git add . && git commit -m "docs: project specification pack" && git push`.

> Claude Code reads `CLAUDE.md` automatically every session. The `.claude/` folder gives it two reviewer helpers (`phase-verifier`, `security-reviewer`), two shortcuts (`/start-phase`, `/finish-phase`), and blocks it from reading your secret `.env` files.

## 2. The rhythm for every phase
1. Open Claude Code in the project folder.
2. Type: **`/start-phase 00`** (then `01`, `02`, … for later phases).
3. Claude Code reads the docs, tells you its plan and what it needs from you (accounts, keys, phones). Give it what it asks for. **Never paste secret keys into the chat** — put them into the env files on your server (Claude Code tells you the exact file and command) or your local `.env.local` file as Claude Code instructs.
4. Let it work task by task. It will stop and ask you when a decision is yours.
5. When it says the phase is complete (or you want to force the check), type **`/finish-phase 00`**.
6. Open `owner/PHASE_TESTING_GUIDE.md` → that phase → do the checks on your phones.
7. Report problems using the template at the bottom of the testing guide. When everything passes, tell Claude Code: **"Phase 00 verified."**
8. Start the next phase — preferably in a **fresh Claude Code session** (progress is saved in `docs/PROGRESS.md`, so nothing is lost).

## 3. First message to Claude Code (copy-paste)
```
Assalamu alaikum. Please read CLAUDE.md, then docs/PROGRESS.md and docs/DECISIONS.md.
We are starting the project. Run /start-phase 00.
Before writing code, list everything you need from me for Phase 00
(accounts, domain, decisions) and anything in the docs you think is
unclear or contradictory.
```

## 4. What you'll be asked for, by phase
| Phase | You provide |
|---|---|
| 00 | GitHub repo, a domain moved to Cloudflare (free account), a **staging VPS** in Mumbai (2 vCPU / 4 GB RAM, Ubuntu LTS, static IP), optional Sentry |
| 01 | MongoDB Atlas staging project (Mumbai), Cloudflare Turnstile keys, your phone for the Super Admin passkey |
| 02 | Android + iPhone for testing |
| 03 | AWS account (MFA on) for image storage — S3 in Mumbai; (later, before pilot) verified Content Library file and reviewed translations |
| 04 | VAPID keys (Claude Code generates; **you back up the private key**) — no new accounts |
| 05 | Your own UPI ID for a ₹1 test |
| 06 | Bunny.net Stream library |
| 07 | Decision on map tiles for the Qibla fallback |
| 08 | Grievance Officer details, lawyer for legal texts |
| 09 | Production VPS + Atlas production cluster (M10, backups on) + production S3 buckets, Google Play developer account, pilot masjids |

## 5. Files in this pack
| File | For | Purpose |
|---|---|---|
| `CLAUDE.md` | Claude Code | Rules of the project; read every session |
| `docs/00_PRODUCT_SPEC.md` | Both | What the app does, every rule |
| `docs/01–10_*.md` | Claude Code | Architecture, data, API, security, legal features, design, screens, motion, languages, testing |
| `docs/design-references/` | Both | Your 3 reference images — the visual target |
| `docs/phases/PHASE_00–09_*.md` | Claude Code | Exactly what to build in each phase |
| `docs/PROGRESS.md` | Both | Where the build is right now |
| `docs/DECISIONS.md` | Both | Every important decision and why |
| `owner/PHASE_TESTING_GUIDE.md` | **You** | What to test after each phase, and how |
| `owner/LEGAL_THINGS_I_NEED_TO_DO_MYSELF.md` | **You** | Legal tasks only a human can do |
| `owner/HANDOFF_FOR_NEW_AI_CHAT.md` | **You** | Paste into a new AI chat to give it the full project context |

## 6. Tips
- If Claude Code proposes changing a rule in the docs, ask it to explain the trade-off and record it in `docs/DECISIONS.md` before you agree.
- If something feels wrong on your phone, it **is** wrong — report it. Design and smoothness are requirements, not extras.
- Keep the Super Admin passkeys on two devices you control. Never share invite links publicly.
- Start the legal tasks (Stage A in the legal file) **now** — lawyer review and content verification take longer than coding.
