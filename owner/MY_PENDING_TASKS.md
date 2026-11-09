# My pending tasks (owner)

> Things only I can do. Tick them as I go and tell Claude Code "O<n> done".
> The same list is kept in `docs/PROGRESS.md` → "Waiting for the owner".
> Last updated: 8 Nov 2026.
>
> **Safety rules for every step:** never paste a private key or password into chat or send one to anyone.
> Public keys (they start with `ssh-ed25519`, `age1…` or a WireGuard *public* key) are fine to share.

## Done

- [x] **O1** — Release-signing key + GitHub `staging` environment (15 Oct 2026)
- [x] **O4** — Showcase on staging: **yes** (15 Oct 2026)
- [x] **O5** — Web font: **keep as is** (15 Oct 2026). I'll judge the opening smoothness on the Poco F7 during O7.
- [x] **Server scripts** installed from the tested commit `9f664d3` (`provision.sh host`, fingerprint checked) (16 Oct 2026)
- [x] **O2** — WireGuard tunnel (`masjid-server` on my PC) + public SSH closed. To reach the server: activate the tunnel, then `ssh talha@10.66.0.1` (16 Oct 2026)
- [x] **First staging deploy**, reboot test, Cloudflare analytics off (16 Oct 2026)
- [x] **Phase 00 accepted** by me (16 Oct 2026) — the remaining review items are finished alongside Phase 01 (DECISIONS #62)
- [x] **F10 / DECISIONS #60** — MongoDB for staging: **Atlas M0 Free** (Mumbai); production M10 is decided in Phase 9
- [x] **Staging only from `main`** — GitHub → Environments → staging → deployment branch `main` (16 Oct 2026)
- [x] **Cloudflare Web Analytics** auto-injection disabled (16 Oct 2026)
- [x] **Atlas** — project `mc-staging`, free cluster in Mumbai, network access = server IP only; `atlas-users.sh staging` created the 4 database users; temporary service account and the wizard's user deleted (16 Oct 2026)
- [x] **Server scripts** updated to `a33610e` (16 Oct 2026)
- [x] **O7 (most of it)** — phone checks passed on iPhone + Poco F7, incl. the update prompt (0.12) and rollback (0.14) (16 Oct 2026)
- [x] **O3** — Log-archive key: created on my PC (`Documents\masjid-logs.key`, backed up), public key on the server; hourly archive runs (16 Oct 2026)
- [x] **A7 — Push**: standing permission to commit + push given to Claude Code (19 Oct 2026); 38 commits pushed to `main`
- [x] **O14 — DECISIONS #70**: "do the best one" → option A (Super Admin created by a one-off api-admin container) (19 Oct 2026)
- [x] **O13** — passkey library `@simplewebauthn/server` 14.0.3 installed (20 Oct 2026)
- [x] **O6 part 0.17** — production: "Allow administrators to bypass" unticked (20 Oct 2026)
- [x] **O11** — GitHub variables `STAGING_APP_URL` / `STAGING_ADMIN_URL` (20 Oct 2026)
- [x] **O10** — Cloudflare Browser Cache TTL → Respect Existing Headers (20 Oct 2026)
- [x] **O15** — Cloudflare Network Error Logging checked (20 Oct 2026)
- [x] **O8 (Turnstile part)** — widget created; site key `0x4AAAAAAFch5ViHreqwA9Mu` given to Claude Code, secret in my password manager (20 Oct 2026)
- [x] **O9** — latency test sent (20 Oct 2026)
- [x] **O18** — Hostinger automatic backups: weekly, on (20 Oct 2026)
- [x] **O19 + F17** — screen readers and iPhone swipe-back checked: working fine (20 Oct 2026)
- [x] **O12** — Super Admin passkey on staging created with my phone (22 Oct 2026)
- [x] **O20** — database privilege check on staging: 17/17 PASS (20 Oct 2026)
- [x] **O36** — Atlas roles updated for Ruqyah + Ilm contacts, server scripts updated to `aea4aba`, database passwords rotated, staging restarted; privilege check shows only the expected "extra" lines until Phase 03 is deployed (6 Nov 2026)
- [x] **O25 (keys part)** — two Cloudinary API keys made and put into the staging env files; media settings added with `make-env.sh --force` (6 Nov 2026)
- [x] **O17** — server scripts updated to `2719f01`, edge networks recreated, `check.sh` 106 PASS · 0 FAIL; staging back with the database connected (20 Oct 2026)

---

## Still to do

> Nothing here blocks Claude Code's work right now (3 Nov 2026). Do them whenever you have time — the "When" column
> says by when each one is needed. Tell Claude Code "O<n> done" and it checks.

### Needed before Phase 03 goes to staging

| # | What | Time | When |
|---|---|---|---|
| O25 | **Cloudinary for staging — rest (keys are done)** — in the Cloudinary console (Image → Studio): create the 7 transformation **templates** `mc_480_avif`, `mc_480_webp`, `mc_960_avif`, `mc_960_webp`, `mc_1440_avif`, `mc_1440_webp` (text `c_limit,w_<size>,f_<avif or webp>,q_auto`) and `audio_m4a` (text `ac_aac,br_48k`), each **allowed for strict transformations**; then Settings → Security → **Strict transformations** on; check the **`media-staging`** DNS record in Cloudflare (A, Proxied, same IP as `app-staging`). The app's keys may not create them (Cloudinary answered 403 "missing permissions (create)"), so this is done by hand. Ask Claude Code for the click-by-click steps again | 15 min | before the Phase 03 staging deploy (photos and voice notes need it) |
| O23 | **Cloudflare cache rule for the app API** — open rule "App API (origin)" and compare it field by field: Hostname **equals** `app-staging.almasjids.com`, URI Path **starts with** `/api/v1/`, Method `GET`, action **Eligible for cache**, Edge TTL "Use cache-control header if present", rule **Deployed**. Staging still answers `DYNAMIC` (25 Oct 2026). Then tell Claude Code to check again | 5 min | any time (open since 25 Oct) |
| O8 | **Turnstile switch-over** — GitHub `staging` environment variable `VITE_PUBLIC_TURNSTILE_SITE_KEY` = your site key **and** the secret into `TURNSTILE_SECRET` of the staging API env files — both together, never via chat | 5 min | any time |

### At the end of Phase 03

| # | What | Time | When |
|---|---|---|---|
| O26 | **Usability check (T3.12)** — sit with a real masjid person (imam / mutawalli) and let them do the 5 tasks without help. The script is ready: `owner/PHASE_TESTING_GUIDE.md` → Phase 03 → "The 5-task usability script" (each task 3–6 taps, no typing). Tell Claude Code where they hesitated | 30 min | end of Phase 03, on staging |
| O27 | **Phase 03 checks on staging** — `owner/PHASE_TESTING_GUIDE.md` → Phase 03, on your phones | 45 min | when Claude Code says "Phase 03 is ready" |

### Phase 04 — notifications

| # | What | Time | When |
|---|---|---|---|
| O37 | ✅ **Done 9 Nov 2026** (keys match on the server and in GitHub) — **Notification keys on staging** — on the server, compare `VAPID_PUBLIC_KEY` in `/etc/masjid-connect/staging/worker.env` with the GitHub `staging` environment variable `VITE_PUBLIC_VAPID_PUBLIC_KEY` (they must be the same text — both are public keys, fine to compare on screen). Then **back up the VAPID private key** (`VAPID_PRIVATE_KEY` in the same file) into your password manager — never into chat. If it is ever lost, every phone must turn notifications on again | 10 min | before the Phase 04 staging deploy |
| O38 | **Real-phone notification checks** — on the Poco F7 (any browser mode) and on the iPhone (only in the installed Home Screen app): Settings → Notifications → Turn on; publish a notice from the admin app; the notification arrives in the phone's language and opens the notice. Also the admin "Alerts on this phone" switch (Masjid Profile → My account) and the Super Admin's test alert. Steps will be in `owner/PHASE_TESTING_GUIDE.md` → Phase 04 | 20 min | when Claude Code says "Phase 04 is ready" |

### Later phases (Claude Code reminds you)

| # | What | Time | When |
|---|---|---|---|
| O28 | **A UPI ID for a ₹1 test** (your own or a masjid's; a business/merchant UPI ID is best for real masjids) | 5 min | Phase 05 |
| O29 | **Qibla check** — compare the arrow with a masjid's mihrab direction on one Android and one iPhone | 10 min | Phase 07 |

### Before the pilot launch

| # | What | Time | When |
|---|---|---|---|
| O30 | **Notice templates** — Super Admin → Notice templates → **Add starter templates**; have someone check each one in all 4 languages (or send `packages/i18n/review/*.csv` to translators), tick **Translations reviewed**, **Activate** | 1–2 h | before pilot |
| O31 | **All app translations reviewed** — send the review files `packages/i18n/review/hi.csv`, `ur.csv`, `te.csv` (about 1,200 strings each, all drafts — 5 Nov 2026) to translators; Claude Code puts their answers back | depends on translators | before pilot |
| O32 | **Verified Content Library file** — hadith / ayah / duas / adhkar (kind `dhikr` with `repeat` and `occasions: ["after_salah"]` — masjids pick them in "Adhkar after salah" since T3.14) / ruqyah from licensed, scholar-checked sources in the format of `docs/content-library-format.md` | — | before pilot |
| O33 | **Grievance Officer details** — name, email and address in Super Admin → Settings (the app hides the contact link while the "NOT SET" placeholders are there) | 5 min | before launch |
| O34 | **Legal checklist** — `owner/LEGAL_THINGS_I_NEED_TO_DO_MYSELF.md` (lawyer review of the privacy policy and terms, etc.) | — | before pilot |
| O35 | **Hadith/Ayah topic chips** — when you try B6 ("Choose another"), say whether the topic chips may show the library's tag words as written (e.g. `patience`, `after fajr`) in every language, or should be translated (then the library file gets a label per language — F51) | — | optional, before pilot |

### Whenever you like

| # | What | Time | When |
|---|---|---|---|
| O7 | **Design notes** — the minor improvements you noticed (list or screenshots) | — | when ready |
| O16 | **Low-end Android phone** (≈ ₹8,000) for a measured check — optional; you said it looks good (27 Oct 2026) | — | optional |
| O6 | **GitHub checks 0.15 + 0.16** (branch ruleset + the failing-PR test, steps below) — after this, `main` changes only through pull requests | 15 min | **do last** |
| O6 | 0.18 Sentry error reporting (steps below) | 15 min | optional |

### Done since the last update

- ~~O21, O22~~ (22 Oct 2026) · ~~O24 bundle sizes~~ (24 Oct: a few kB is fine) · ~~Cloudinary keys on this PC~~ (1 Nov 2026)
- **T3.0 accepted with a small tolerance** (3 Nov 2026, DECISIONS #116) · **Simple Qibla page** (3 Nov 2026, DECISIONS #118)

---

## O2 — WireGuard tunnel + close public SSH (about 20 min)

**Why:** today anyone on the internet can *try* to SSH into the server. It's key-only and fail2ban blocks
repeated failures, but after this step the server only accepts SSH through a private tunnel from my PC.
**Needed before:** T0.14 can be ticked.
**Do it:** after the first staging deploy, with Claude Code in the session (it installs the scripts used below).

**A. On the server, start WireGuard**
1. Log in as usual: `ssh talha@<server IP>`
2. Run:
   ```
   sudo bash /usr/local/lib/masjid-connect/provision.sh wireguard
   ```
3. It prints `Server public key (put it in each device's WireGuard config): …`. **Copy that key** (it's public).

**B. On my Windows PC, create the tunnel**
1. Install the **WireGuard** app from **wireguard.com/install** (Windows installer).
2. Open it → arrow next to **Add Tunnel** → **Add empty tunnel…**
3. The app fills in a `PrivateKey` line itself and shows a **Public key** at the top. **Copy that public key**.
   (Never copy or share the `PrivateKey` line.)
4. Name: `masjid-server`. Below the `PrivateKey` line, the text box should end up looking like this:
   ```
   [Interface]
   PrivateKey = (already filled in by the app — leave it)
   Address = 10.66.0.2/32

   [Peer]
   PublicKey = <server public key from A.3>
   AllowedIPs = 10.66.0.1/32
   Endpoint = <server IP>:51820
   PersistentKeepalive = 25
   ```
5. Click **Save**. Don't activate it yet.

**C. On the server, allow my PC into the tunnel**
1. In the server terminal (replace with the public key from B.3):
   ```
   sudo bash /usr/local/lib/masjid-connect/provision.sh wg-peer talha-pc <PC public key> 10.66.0.2
   ```
   It prints `peer talha-pc (10.66.0.2) added`.

**D. Test the tunnel (keep the old terminal open!)**
1. In the WireGuard app, click **Activate**. It should show *Active*, with "Latest handshake" a few seconds ago.
   - No handshake? In the Hostinger panel check whether a VPS firewall is on. If it is, allow **UDP 51820**.
2. Open a **second** PowerShell window and run: `ssh talha@10.66.0.1`
3. On the server in that second window, run: `echo $SSH_CONNECTION`. It must **start with `10.66.0.2`**.
   If it doesn't, stop and tell Claude Code.

**E. Close public SSH**
1. Only in the **second** window (the tunnel one), run:
   ```
   sudo SSH_CONNECTION="$SSH_CONNECTION" bash /usr/local/lib/masjid-connect/provision.sh lockdown
   ```
   It prints the firewall rules. Port 22 should be allowed only on `wg0`.
2. Test in a **third** window: `ssh talha@<server IP>`. This must now **fail / time out**. That's correct.
3. `ssh talha@10.66.0.1` (with the tunnel active) must still work.
4. Now it's safe to close the old windows.

**From now on:** to reach the server, first **activate the tunnel** in the WireGuard app, then `ssh talha@10.66.0.1`.
**If I'm ever locked out:** the Hostinger panel has a **browser terminal / VNC console** that always works.

*(Optional)* My phone as a second way in: same steps B–C with the WireGuard phone app, Address `10.66.0.3/32`,
and name `talha-phone` in C.1.

Tell Claude Code "**O2 done**". It runs `check.sh`, and the 2 SSH/WireGuard FAILs should turn into PASS.

---

## O3 — Log-archive key (about 5 min)

**Why:** Indian law (CERT-In) needs the server's logs kept for 180 days. They are stored **encrypted** so that
only I can read them, using a key that never leaves my PC.

1. On my PC, open **PowerShell** and install the tool:
   ```
   winget install FiloSottile.age
   ```
   Then **close and reopen** PowerShell.
2. Go to a safe folder (for example `cd $HOME\Documents`) and create the key:
   ```
   age-keygen -o masjid-logs.key
   ```
   It prints `Public key: age1…`. **Copy the `age1…` text** (it's public).
3. **`masjid-logs.key` is my private key.** Copy it to a USB drive or a password manager as well.
   If it's lost, the archived logs can never be read. Never send it to anyone.
4. On the server (through the tunnel), with my own `age1…` key pasted in:
   ```
   echo 'age1...' | sudo tee /etc/masjid-connect/log-archive.pub
   ```
5. Tell Claude Code "**O3 done**". It checks that the hourly archive now runs.

---

## O6 — GitHub checks 0.15–0.17 (about 15 min)

Do these **after** Claude Code has merged the T0.14 work into `main`.

**0.15 — Branch protection**
1. Go to github.com/syedtalha88/Al-Masjid → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset name:** `main` · **Enforcement status:** **Active**.
3. **Target branches** → **Add target** → **Include default branch**.
4. Tick:
   - **Restrict deletions**
   - **Block force pushes**
   - **Require a pull request before merging** → required approvals **0** (fine while I work alone)
   - **Require status checks to pass** → **Add checks** → add these 6, typing each name:
     - `Typecheck · lint · format · i18n`
     - `Unit + component tests (coverage gates)`
     - `Security scans`
     - `Integration tests (MongoDB + Redis)`
     - `Build · budgets · images · e2e · Lighthouse`
     - `CodeQL (javascript-typescript)`
5. **Create**. ✅ The ruleset shows **Active**.

**0.16 — A failing change is blocked**
1. Tell Claude Code: "make the 0.16 test PR". It pushes a branch with one deliberately failing test.
2. On GitHub → **Pull requests** → open the PR it names.
3. ✅ CI shows a red ✗ and the **Merge** button is blocked.
4. Click **Close pull request**, then **Delete branch**.

**0.17 — Production needs my approval**
1. **Settings** → **Environments** → `production` (if it's missing: **New environment** → `production` → **Configure environment**).
2. Tick **Required reviewers** → add **syedtalha88** → **Save protection rules**.
3. **Deployment branches and tags** → **Selected branches and tags** → **Add deployment branch or tag rule** → `main` → **Add rule**.
4. ✅ Any production release will wait for my click.

**0.18 — Error reporting (optional, free)**
1. Create a free account at **sentry.io** and turn on 2-factor login.
2. Create 2 projects: `mc-web` (Browser JavaScript) and `mc-server` (Node.js).
3. In **each** project → **Settings** → **Security & Privacy**: turn ON *Prevent Storing of IP Addresses*,
   *Data Scrubber* and *Use Default Scrubbers*.
4. Give Claude Code the **org slug** and the **two DSNs** (not secret).
5. **Settings** → **Auth Tokens** → create a token with scope *project:releases* → paste it **only** into
   GitHub → Settings → Secrets and variables → Actions → **New repository secret** `SENTRY_AUTH_TOKEN`.

Tell Claude Code "**O6 done**" (and whether I did 0.18).

---

## O7 — Phone checks 0.1–0.14 (30–45 min)

**Needs:** the staging links from Claude Code (app, admin, and `/_dev/showcase` on both).
**Phones:** iPhone + Poco F7. **Mark each ✅ / ❌.** For every ❌, take a screen recording.

| # | Check | How | ✅ when |
|---|---|---|---|
| 0.1 | App opens | Open the staging app link on both phones | Opens fast, warm off-white background, no errors |
| 0.2 | Security grade | On the laptop, paste the app URL and then the admin URL into **securityheaders.com** | **A+** for both |
| 0.3 | Looks premium | Open `/_dev/showcase`, scroll everything | Same green, mint panels, rounded cards, clean fonts as the reference images |
| 0.4 | Languages | In the showcase switch English → हिन्दी → اردو → తెలుగు | All text changes; **Urdu flips the layout right-to-left**; no "□" boxes |
| 0.5 | Navigation | Open the demo screens; go forward and back; swipe from the left edge (from the right in Urdu) | iPhone-like slide; follows the finger; stopping halfway returns smoothly |
| 0.6 | Android back | Poco F7: system back button on a demo screen | Goes back one screen with animation; doesn't exit |
| 0.7 | Bottom sheets | Open the demo sheet; drag up/down; flick down | Moves with the finger, snaps, flick closes it |
| 0.8 | Tab bar | Tap each tab and the green centre Scan button | Active tab turns green; centre button presses and bounces back |
| 0.9 | Reduced motion | Poco: Settings → Accessibility → *Remove animations* ON. iPhone: Accessibility → Motion → *Reduce Motion*. Reopen the app | Screens **fade** instead of slide. Turn it **OFF** again afterwards |
| 0.10 | Install | Poco: Chrome menu ⋮ → *Install app*. iPhone: **Safari** → Share → *Add to Home Screen* | Icon on the home screen; opens full screen without the browser bar |
| 0.11 | Offline | Open the installed app → Airplane mode ON → close it fully → reopen | App opens with an offline message, not the browser's "no internet" page |
| 0.12 | Update | Tell Claude Code "ready for 0.12"; it deploys a tiny change; reopen the app | "Update available" appears; tapping it refreshes |
| 0.13 | Server locked | Read the `check.sh` result Claude Code gives me. Then on the laptop open `https://<server IP>` | All **PASS**; the IP address does **not** open the app |
| 0.14 | Rollback | Tell Claude Code "show me a rollback" | The previous version is back within minutes, then the latest is redeployed |

**Extra for the iPhone (F17):**
- In **Safari** and in the **installed app**, swipe back from the left edge on a demo screen.
  It must slide back **once**, smoothly, with no double animation.
- In the showcase, check that **bold text looks bold**, and that dragging a sheet and then scrolling inside it feels natural.

**Opening smoothness (O5):** open the installed app a few times on the Poco F7. If the text visibly jumps or
flickers as it opens, tell Claude Code.

Tell Claude Code "**O7 done**", with the ❌ list if there is one.

---

## O22 — server scripts update (22 Oct 2026)

Through the WireGuard tunnel, as `talha` on the server. Server scripts version `aa2d1ac` (22 Oct 2026). Any time —
staging keeps working before and after.

```bash
cd /tmp
curl -fsSLO https://raw.githubusercontent.com/syedtalha88/Al-Masjid/aa2d1ac13fd0a1ca78e965d3a773367cddc04fa8/infra/vps/provision.sh
sha256sum provision.sh
#   must print: 805c175c64055f69fc2c74b10b63619734a04068df7ac2ef3e035aa992a76b96  provision.sh
#   if it prints anything else: stop and tell Claude Code
sudo bash provision.sh host aa2d1ac13fd0a1ca78e965d3a773367cddc04fa8
sudo /usr/local/lib/masjid-connect/make-env.sh staging --force        # keeps every password and key; rewrites the Redis access list
sudo docker restart $(sudo docker ps -q --filter label=com.docker.compose.project=mc-staging --filter label=com.docker.compose.service=redis)
sudo systemctl start mc-deploy@staging.service                         # deploys the newest release now instead of waiting for the timer
sudo /usr/local/lib/masjid-connect/deploy.sh staging --verify-roles   # send Claude Code the whole output (no secrets in it)
sudo /usr/local/lib/masjid-connect/check.sh                           # send Claude Code the summary line + any FAIL/WARN lines
```

Then check from your PC: <https://app-staging.almasjids.com/api/v1/health> shows the newest release (`aa2d1ac` or later), `"db":"ok"`, `"redis":"ok"`.

---

## F10 — MongoDB for staging (decide before Phase 01)

The free MongoDB Atlas tier probably can't do the custom roles and views the security design needs.
1. Ask Claude Code: "**give me the F10 comparison**". It checks current Atlas tiers and prices.
2. Choose one:
   - **Paid Atlas tier for staging** (monthly cost, matches production exactly), or
   - **MongoDB on our own VPS for staging** (free, more setup and maintenance work for Claude Code).

---

## O8 — Accounts for later phases (when Claude Code asks)

| When | What | Steps |
|---|---|---|
| Phase 01 | **MongoDB Atlas** project `mc-staging` (only if F10 = Atlas) | Claude Code gives click-by-click steps: region **Mumbai (ap-south-1)**, DB users, IP access |
| Phase 01 | **Cloudflare Turnstile** widget (the "I'm not a robot" check) | Cloudflare dashboard → Turnstile → Add widget → domains `admin-staging.almasjids.com`. Site key → Claude Code; secret key → server env file only |
| Phase 03 | **Cloudinary API keys** (2 keys: api-admin + worker) | Cloudinary → Settings → API Keys → Generate. They go only into the server env files |
| Phase 03/08 | **Cloudflare purge token** | Cloudflare → My Profile → API Tokens → Create → *Cache Purge* for almasjids.com only |
| Before Phase 04 | **Back up the VAPID private key** | Claude Code gives the command. Store it with the log key. It must never change once push goes live |
