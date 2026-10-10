# PHASE 06 — Bayan Videos

## Goal
Admins upload bayans to their masjid's own YouTube channel and paste the link; the app validates it, turns it into a privacy-friendly embed, and followers watch it in the app — with the audience choice (everyone / brothers / sisters) respected and no video hosting cost (DECISIONS #39).

## Read before starting
`CLAUDE.md` · `DECISIONS.md` #39, #40 · `00_PRODUCT_SPEC.md` §4.3 (Bayan videos) · `01_ARCHITECTURE.md` §5.4, §5.5 · `02_DATA_MODEL.md` (`items.video`, `items.audience`) · `03_API_SPEC.md` (Videos admin) · `04_SECURITY.md` §6 (YouTube parsing, outbound requests), §7 (CSP `frame-src`) · `05_LEGAL_COMPLIANCE_IMPLEMENTATION.md` §9 · `07_SCREEN_SPECS.md` A12, B10 · `08_MOTION.md` §3.5 (video shared element), §5.12.

## Owner prerequisites
None new. Each pilot masjid needs a YouTube channel to upload to (the admin's own account). For the owner test, one Unlisted and one Public test video on any channel the owner controls.

## Out of scope
Hosting or uploading video files, live streaming, downloads, comments, custom player controls, offline playback.

---

## Tasks

### T6.1 — YouTube link parser + oEmbed/thumbnail adapter (verify current YouTube oEmbed behaviour first)
**Do:** `packages/domain/youtube`: `parseYouTubeLink(input) → {id, startS?} | {error}` per 04 §6 (WHATWG `URL`, `https:` only, exact host allow-list, paths `/watch?v=`, `youtu.be/<id>`, `/shorts/<id>`, `/live/<id>`, `/embed/<id>`, id `^[A-Za-z0-9_-]{11}$`, `t`/`start` in seconds or `1h2m3s` → 0..86400), `embedUrl(id, startS?)` building `https://www.youtube-nocookie.com/embed/<id>?autoplay=1&rel=0&playsinline=1[&start=n]`. `packages/api/src/video/youtube.ts`: oEmbed lookup (fixed host, URL built from the id, 5 s timeout, no cross-host redirects, response size limit) → `{title}` or `VIDEO_UNAVAILABLE`; thumbnail fetch from `i.ytimg.com` (fixed host, type/size limits) → image pipeline (01 §5.5) → Cloudinary. `mock.ts` adapter for local/tests. Record the verified oEmbed details (status codes for private / deleted / embedding-disabled videos) in DECISIONS.
**Acceptance:** [ ] Parser property tests (fast-check): every accepted input yields a valid id; look-alike hosts (`youtube.com.evil.example`, `evil.example/youtube.com/watch?v=…`), `http:`, playlists without `v`, channels and garbage are rejected. [ ] Table tests for every supported link form incl. start times. [ ] Adapter contract tests against the mock and (opt-in flag) the real oEmbed endpoint.

### T6.2 — Admin flow (B10)
**Do:** Help step + "Paste link" (clipboard on tap) + text field; instant client-side parse; `POST /videos/preview` → preview card (server-copied thumbnail, title pre-filled, editable); speaker/description; **audience** (required, no default) with the sisters-only warning card ("Anyone who has this YouTube link can watch it outside the app. Upload it as Unlisted."); ownership checkbox; `PublishBar` → `POST /videos` (stores only id + start seconds; publishes immediately; outbox + audience-filtered push). Video list (Published / Removed / Deleted), edit ≤ 24 h, delete. All strings in 4 locales.
**Acceptance:** [ ] Integration tests: valid link publishes; invalid → `422 INVALID_VIDEO_LINK`; private/deleted/embedding-disabled (mock) → `422 VIDEO_UNAVAILABLE`; the pasted URL never appears in the DB document or logs. [ ] Rate limit (30/hour/masjid) enforced. [ ] E2E: paste → preview → choose sisters → warning visible → publish.

### T6.3 — Musalli Bayans & player (A12)
**Do:** Bayans list (Masjid Detail row + Updates chip "Bayans"), audience filtering server-side, `VideoCard`, Player screen with `YouTubeFacade` (our thumbnail + play button + "Plays from YouTube"); on tap only, insert the `youtube-nocookie` iframe (`allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`, `referrerpolicy="strict-origin-when-cross-origin"`, title from the item). Offline → "Connect to the internet to watch", no iframe. CSP `frame-src https://www.youtube-nocookie.com` (app origin only). Shared-element thumbnail → player (progressive).
**Acceptance:** [ ] E2E journey 10 (sisters-only hidden for brothers; visible for sisters). [ ] Network assertion: **no request to any Google/YouTube host before Play is tapped** (list, detail and player screens). [ ] CSP violation-free on Pixel 7 + iPhone 14 profiles. [ ] Facade accessible (button name includes the bayan title) and correct in RTL.

### T6.4 — Deletion & retention
**Do:** On admin delete **or** moderation removal: item hidden immediately (version bump); its copied thumbnail is deleted from Cloudinary by the retention job (`media-delete`) after the 180-day preservation period (same rule for both cases). The takedown response text explains that the video itself stays on the masjid's YouTube channel.
**Acceptance:** [ ] Retention job deletes the thumbnail (mock adapter) at the right time and purges Cloudflare.

### T6.5 — Quality gates
**Do:** Visual baselines (list, facade, admin flow incl. warning, 4 locales); bundle budget (player route chunk ≤ 60 KB gz like any lazy route); CSP violation-free; security review (link parsing, outbound fetches, CSP).

---

## Phase exit criteria
Owner pastes a real YouTube link from a phone, publishes a sisters-only bayan and an everyone bayan, confirms the brothers device sees only the second, and plays it on a weak network (owner guide Phase 06); phase-verifier PASS; security-reviewer clean.
