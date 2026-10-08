# 02 — Data Model (MongoDB)

> **Source of truth:** Zod document schemas in `packages/db/src/schema/*.ts`. From them we generate (a) TypeScript types and (b) MongoDB `$jsonSchema` validators. Versioned migrations in `packages/db/migrations/` create collections with those validators, indexes and views. `pnpm db:schema:check` compares the generated validators/indexes with the live database and fails CI on drift.
> **Database:** MongoDB Atlas, AWS ap-south-1 (Mumbai), replica set; one database per environment (`MONGODB_DB_NAME`).
> This document keeps every rule of the original (Postgres) model. Where Postgres used a trigger, RLS policy, column grant or SECURITY DEFINER function, the MongoDB equivalent is stated explicitly (§3–§5, DECISIONS #20, #26).

## 0. Conventions
- **Collections** are snake_case plural (same names as the original tables). **Field names** in documents are snake_case (repositories map to camelCase for API contracts).
- **`_id`**: BSON UUID v4 (`new UUID()`, Binary subtype 4) unless stated (DECISIONS #22). Foreign keys are stored as UUID fields named `<thing>_id`. Referential integrity (what Postgres FKs did) is enforced by the data layer inside transactions + tests; delete behaviour for every reference is stated below.
- **Timestamps:** `created_at`, `updated_at` are BSON `Date` (UTC), set by the data layer on every insert/update (no triggers). Display in `Asia/Kolkata`.
- **Calendar dates** (IST): strings `YYYY-MM-DD` (validated pattern). **Wall-clock times:** strings `HH:mm` (24h, validated).
- **Money:** integer **paise** stored as BSON `long` (int64) — written through `toInt64()` which rejects non-integers and values > 10^12. Never `double`.
- **Small integers** (minutes, offsets, quotas) as BSON `int` with `minimum`/`maximum` in the validator.
- **Text limits:** every string field has `maxLength` in both the Zod schema and the validator (the "≤N" numbers below). Strings are NFC-normalized and trimmed before storage (04 §6).
- **Enums:** Zod enums → validator `enum`.
- **i18n objects:** embedded objects `{en?, hi?, ur?, te?}` with per-key `maxLength`; `additionalProperties: false`.
- **Validators:** `validationLevel: "strict"`, `validationAction: "error"`, `additionalProperties: false` at every object level (no unknown fields can be written).
- **Absent vs null:** optional fields are **absent** (`$unset`), never `null`, unless a field is described as nullable. Partial unique indexes rely on this.
- **Soft deletes:** `deleted_at` / `removed_at` Dates; retention (§6) hard-deletes later.
- **Transactions:** every operation that writes more than one document runs in `withTransaction()` (majority read/write concern).
- **NoSQL-injection safety:** all filter values come from Zod-parsed primitives; repositories only accept typed arguments (never raw filter objects from callers); a guard rejects any string key beginning with `$` or containing `.` reaching a filter/update; Express runs with `query parser: 'simple'` (03 §0).

## 1. Enums

```
masjid_status:        pending | active | suspended | deleted
admin_role:           super_admin | masjid_admin
masjid_admin_role:    owner | editor
admin_status:         invited | active | disabled
invite_purpose:       register | add_device | recovery
calc_method:          karachi | mwl | isna | egypt | umm_al_qura | other_custom
asr_madhab:           hanafi | shafi
prayer:               fajr | dhuhr | asr | maghrib | isha
adhan_mode:           auto | manual
jamaat_mode:          fixed | offset | none
special_type:         eid_ul_fitr | eid_ul_adha | taraweeh | shab_e_barat | shab_e_qadr | other
item_type:            announcement | daily_content | dua_request | campaign | chanda_update | video | timing_update
item_status:          draft | published | hidden | deleted | removed   -- hidden = auto-hidden pending review (Phase 8)
audience:             everyone | brothers | sisters
audience_pref:        brothers | sisters
locale:               en | hi | ur | te
announcement_category: general | event | facilities | timing
dua_category:         illness | inteqal | other
library_kind:         hadith | ayah | dua
library_status:       draft | verified | retired
template_status:      active | retired
campaign_purpose:     renovation | repair | utilities | welfare | other
campaign_status:      active | completed | closed
payment_status:       pending | approved_on_hold | active | rejected | superseded
video_source:         upload | youtube
video_status:         uploading | processing | ready | failed
push_status:          active | dead | none
job_status:           pending | running | completed | failed
report_reason:        misleading | hateful | off_topic | fraud | private_info | copyright | other
report_status:        open | actioned | dismissed
grievance_status:     open | acknowledged | resolved | rejected
legal_order_status:   received | actioned | contested | closed
actor_type:           admin | super_admin | system | device
```

## 2. Collections

### Masjids & admins
**masjids**
| field | type | notes |
|---|---|---|
| _id | UUID | |
| follow_code | string(8) | unique; Crockford Base32, generated with retry on duplicate-key error (§3) |
| name | string ≤120 | primary (Latin) |
| name_i18n | object `{hi?, ur?, te?}` each ≤120 | |
| area, city, state | string ≤80 | |
| address | string ≤300 | |
| lat, lng | double | validator: lat 6–37.5, lng 68–97.5 (India bounding box); 6 decimal places max (rounded by data layer) |
| photo_key, photo_thumbhash | string, optional | storage key / thumbhash |
| status | masjid_status, default `pending` | |
| verified_at | Date, optional | |
| calc_method | calc_method, default `karachi` | |
| asr_madhab | asr_madhab, default `hanafi` | |
| hijri_offset | int −2..2, optional | absent → global |
| show_chanda | bool, default false | |
| chanda_week_start | int 1..7, default 5 | 1=Mon..7=Sun (5 = Fri) |
| ramadan_start, ramadan_end | date string, optional | |
| sehri_precaution_min | int 0..15, default 0 | |
| iftar_precaution_min | int 0..10, default 0 | |
| push_daily_quota | int 0..50, default 8 | |
| video_quota_bytes | long, default 21474836480 | 20 GB |
| video_used_bytes | long, default 0 | maintained by data layer (§5) |
| content_version | long, default 1 | bumped by data layer on every content change (§5) |
| admin_count | int 0..5, default 0 | maintained by data layer; enforces ≤ 5 admins |
| removals_90d_cache | int, optional | repeat-violation counter cache (Phase 8) |
| created_at, updated_at, deleted_at | Date | |
Indexes: `{follow_code:1}` unique · `{status:1, created_at:-1}` · `{name:1}` (super admin search; plus `{city:1}`).

**masjid_stats** (public-traffic counters, DECISIONS #26c): `_id` = masjid_id, `followers` int ≥ 0, `ameens_7d` int ≥ 0 (Ameens on this masjid's dua requests in the last 7 days — recomputed hourly by the `stats-snapshot` job, feeds admin `GET /stats`), `updated_at`. `followers` written by `mc_public` (`$inc`) and `mc_system` (reconcile); read by admins/super admin.

**admin_users**: `_id`, `display_name ≤80`, `role admin_role`, `status admin_status`, `phone_enc string` optional (AES-256-GCM, app-level, format `v1:<keyId>:<iv>:<ct+tag>` — the key id is embedded in the value, replacing the old separate `phone_key_id` column), `ui_locale locale default 'en'`, `user_handle Binary(32)` (WebAuthn user handle, random), `undertaking_version string` optional, `undertaking_accepted_at Date` optional, `undertaking_history [{version, accepted_at}]` (≤ 50), `last_login_at`, `removed_at` optional, timestamps. Index `{role:1, status:1}`, `{user_handle:1}` unique.

**masjid_admins**: `_id`, `masjid_id`, `admin_id`, `role masjid_admin_role`, `added_by`, `created_at`. Unique `{masjid_id:1, admin_id:1}`; index `{admin_id:1}`. Limit ≤ 5 per masjid enforced via `masjids.admin_count` (§5). On admin removal from masjid: document deleted (audited).

**webauthn_credentials**: `_id`, `admin_id`, `credential_id Binary` (unique), `public_key Binary`, `sign_count long default 0`, `transports [string]`, `aaguid UUID` optional, `backed_up bool`, `device_type string ≤32`, `label ≤60` (e.g. "Redmi 12 — added 3 Oct"), `created_at`, `last_used_at`, `revoked_at` optional. Indexes: `{credential_id:1}` unique, `{admin_id:1}`.

**admin_invites**: `_id`, `admin_id`, `purpose invite_purpose`, `token_hash Binary(32)` unique (SHA-256 of 32-byte random token + pepper), `expires_at` (72h), `used_at` optional, `open bool` (true until used/superseded/revoked), `created_by`, `created_at`. Unique partial index `{admin_id:1, purpose:1}` where `{open: true}` → one unused invite per (admin, purpose); creating a new invite closes the previous open one in the same transaction.

**admin_sessions**: `_id`, `admin_id`, `token_hash Binary(32)` unique, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `step_up_at` optional, `ua_summary ≤120` (browser + OS only), `revoked_at` optional, `revoked_reason ≤80`. Indexes: `{token_hash:1}` unique, `{admin_id:1, revoked_at:1}`, `{absolute_expires_at:1}`.

### Timings
**masjid_timings** (one document per masjid; DECISIONS #26b): `_id` = masjid_id, `prayers` object with keys `fajr|dhuhr|asr|maghrib|isha` each `{adhan_mode, adhan_time? "HH:mm" (manual), adhan_adjust_min int −15..15 default 0 (auto), jamaat_mode, jamaat_time? "HH:mm", jamaat_offset_min? int 0..60}`, `jumuah` array 1..3 of `{seq 1..3, khutbah_time?, jamaat_time}` (unique seq, sorted), `masjid_visible bool`, `rev int` (optimistic concurrency; incremented on every save), `updated_by`, `updated_at`. Consistency rules (validator `oneOf` per mode + Zod refinement): manual ⇒ `adhan_time` present; fixed ⇒ `jamaat_time` present; offset ⇒ `jamaat_offset_min` present; none ⇒ neither.

**special_timings**: `_id`, `masjid_id`, `type special_type`, `date` (YYYY-MM-DD), `label ≤80` optional, `times` array 1..5 of `{time "HH:mm", label? ≤40}`, `note ≤300` optional, `masjid_visible bool`, `created_by`, timestamps, `deleted_at` optional. Index `{masjid_id:1, date:1}`.

### Content (unified feed)
**items** — one document per feed entry; type-specific data **embedded** (DECISIONS #26a).
| field | type | notes |
|---|---|---|
| _id | UUID | internal |
| public_id | string(12) | unique; random URL-safe (used in URLs/push) |
| masjid_id | UUID | |
| type | item_type | |
| status | item_status | |
| audience | audience, default `everyone` | |
| title | string ≤120, optional | free-text title; absent for template/library items |
| body | string ≤1500, optional | free text |
| content_locale | locale, optional | language of free text |
| template_key | string, optional | references `notice_templates._id` |
| template_params | object, optional | validated against the template's param schema |
| is_important | bool, default false | |
| image_key, image_thumbhash | string, optional | |
| rights_confirmed | bool, optional | ownership checkbox for images/videos (05 §9) |
| notify | bool | whether publish requested a push |
| masjid_visible | bool | mirror of `masjids.status == 'active' && !deleted_at` (§5) |
| published_at | Date, optional | |
| published_version | long, optional | masjid `content_version` at first publish (used for CDN purge enumeration) |
| edited_at | Date, optional | |
| created_by | UUID (admin) | |
| deleted_at, removed_at | Date, optional | |
| removed_reason | string ≤300, optional | moderation |
| purge_after | Date, optional | removed/deleted + 180 days (§5) |
| announcement | `{category announcement_category, event_at? Date}` | type = announcement / timing_update (system templates) |
| daily | `{library_id UUID, kind 'hadith'|'ayah', note? ≤200}` | type = daily_content |
| dua | `{category dua_category, person_name? ≤80, name_private bool default true, library_id UUID, janaza_at? Date, janaza_place? ≤120, archived_at? Date}` | type = dua_request |
| campaign | `{purpose campaign_purpose, target_paise long ≥ 100000, received_paise long ≥ 0 default 0, received_updated_at?, received_updated_by?, starts_on date, ends_on? date, status campaign_status, payment_profile_id UUID (snapshot reference at creation), cover_key?, cover_thumbhash?}` | type = campaign |
| chanda | `{chanda_week_id UUID}` | type = chanda_update |
| video | `{source video_source, bunny_video_id? UUID, youtube_id? string(11), speaker? ≤80, duration_sec? int, size_bytes? long, thumbnail_url? ≤500, video_status, failure_reason? ≤200}` | type = video; validator: exactly one of bunny/youtube set by source |
| created_at, updated_at | Date | |
Validator: `oneOf` by `type` — exactly the matching detail object is present, others absent.
Indexes: `{public_id:1}` unique · `{masjid_id:1, status:1, published_at:-1, _id:-1}` · `{masjid_id:1, type:1, status:1, published_at:-1, _id:-1}` · `{masjid_id:1, audience:1, status:1, published_at:-1, _id:-1}` partial `{status:'published'}` · `{purge_after:1}` partial `{purge_after: {$type: 'date'}}` · `{"campaign.status":1, "campaign.ends_on":1}` partial `{type:'campaign'}` · `{"video.bunny_video_id":1}` partial `{type:'video'}`.

**ameens**: `_id`, `dua_item_id`, `masjid_id` (copied from the item, for weekly stats), `device_id`, `created_at`. Unique `{dua_item_id:1, device_id:1}` (once per device); index `{device_id:1}` (Clear all data / retention); index `{masjid_id:1, created_at:-1}` (stats job). Admins never read this collection (it holds device ids).
**ameen_counters** (DECISIONS #26c): `_id` = dua item id, `count` int ≥ 0, `updated_at`. Incremented in the same transaction as a successful (non-duplicate) ameen insert.
**campaign_amount_history**: `_id`, `campaign_item_id`, `masjid_id`, `received_paise long`, `updated_by`, `created_at`. **Append-only** (DB privileges: insert + find only for non-system users). Index `{campaign_item_id:1, created_at:-1}`.
**chanda_weeks**: `_id`, `masjid_id`, `week_start` (YYYY-MM-DD), `amount_paise long ≥ 0`, `note ≤200` optional, `item_id` optional (feed entry), `visible bool` (mirror of `masjids.show_chanda`, §5), `masjid_visible bool`, `created_by`, timestamps. Unique `{masjid_id:1, week_start:1}`.

### Library & templates
**content_library**: `_id`, `kind library_kind`, `arabic ≤4000`, `transliteration {en?, hi?, ur?, te?}`, `translation {en (required), hi?, ur?, te?}`, `reference ≤200` (e.g., "Sahih al-Bukhari 1"), `source_name ≤120`, `source_license ≤200`, `tags [string ≤40] ≤20` (e.g. `[shifa, illness]`), `dua_category dua_category` optional, `verified_by ≤120` optional, `verified_at` optional, `status library_status`, `import_batch_id`, `search_text` (normalized: lowercase, NFKD, Arabic harakat/tatweel removed, all translations + transliterations + reference + tags; generated by the data layer), timestamps. Only `verified` documents are selectable by admins. Indexes: `{kind:1, reference:1}` unique (duplicate detection) · `{status:1, kind:1, dua_category:1}` · text index on `search_text` with `default_language: "none"`.
**notice_templates**: `_id` = key string (e.g. `no_water_time_range`), `category announcement_category`, `icon ≤40`, `is_important_default bool`, `title {en,hi,ur,te}`, `body {en,hi,ur,te}` (ICU MessageFormat with named params), `params` array of `{name, type: time|date|date_range|time_range|prayer|number|short_text, required}`, `status template_status`, `translation_reviewed bool`, `system bool` (system templates such as `payment_details_updated`, not pickable by admins), timestamps.

### Payments
**payment_profiles**: `_id`, `masjid_id`, `vpa ≤100` (pattern `^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$`), `payee_name ≤100`, `status payment_status`, `open bool` (true while `pending|approved_on_hold`), `requested_by`, `request_note ≤300`, `reviewed_by` optional, `reviewed_at` optional, `effective_at Date` optional (approved + hold), `reject_reason ≤300` optional, `masjid_visible bool`, timestamps.
Indexes: unique partial `{masjid_id:1}` where `{status:'active'}` (one active per masjid) · unique partial `{masjid_id:1, open:1}` where `{open:true}` (one pending/on-hold per masjid) · `{status:1, effective_at:1}` (activation job).
State machine (enforced **only** by `packages/db/src/state/payment.ts` — §3): `pending → approved_on_hold (super admin) → active (system job at effective_at; previous active → superseded)`; `pending → rejected`. First-ever profile for a masjid: same flow (no shortcut). There is no generic update method for this collection.

### Devices & push
**devices**: `_id` UUID, `secret_hash Binary(32)` (SHA-256 of secret), `locale locale`, `audience_pref audience_pref` (`brothers|sisters`, required), `platform` enum `android|ios|desktop|other`, `push_endpoint` string ≤1000 https only (optional), `push_p256dh` ≤200 (optional), `push_auth` ≤100 (optional), `push_status push_status default 'none'`, `push_updated_at` optional, `privacy_version string ≤20`, `follow_count int 0..20` (maintained by data layer), `created_at`, `last_seen_at` (updated at most once/day). **No IP, no UA string, no geo.** Indexes: unique partial `{push_endpoint:1}` where `{push_endpoint: {$type: 'string'}}` · `{last_seen_at:1}` · `{push_status:1, push_updated_at:1}`.
**device_follows**: `_id`, `device_id`, `masjid_id`, `muted bool default false`, **denormalized from the device** (DECISIONS #26d): `audience_pref`, `locale`, `push_active bool` (= device `push_status == 'active'`), `created_at`. Unique `{device_id:1, masjid_id:1}`. Fan-out/count index `{masjid_id:1, muted:1, push_active:1, audience_pref:1, device_id:1}`. Limit ≤ 20 per device via `devices.follow_count` (§5). Device deletion deletes its follows in the same transaction.

**admin_push_subscriptions**: `_id`, `admin_id`, `endpoint` unique, `p256dh`, `auth`, `created_at`, `last_ok_at`. Used for Super Admin SLA alerts and admin alerts such as "UPI change approved", "video ready/failed". Policy: admin find/insert/delete own.

**notification_jobs** (the push **outbox**): `_id`, `item_id`, `masjid_id`, `status job_status`, `audience`, `audience_targets [audience_pref]`, `targeted int`, `sent int`, `failed int`, `pruned int`, `pending_batches int`, `bypass_quota bool`, `created_at`, `started_at`, `last_progress_at`, `completed_at`, `last_error ≤500`. Indexes: `{status:1, created_at:1}` · `{masjid_id:1, created_at:-1}` · `{item_id:1}`.
**push_quota_usage**: `_id` = `"<masjidId>:<YYYY-MM-DD>"` (IST day), `masjid_id`, `day`, `count int`. Incremented with conditional update (`count < quota`) inside the publish transaction.

### Moderation, grievance, legal, audit
**reports**: `_id`, `target_type` enum `item|masjid`, `target_id` UUID, `masjid_id`, `reason report_reason`, `details ≤500` optional, `device_id` optional (cleared when the device is deleted), `urgent bool`, `status report_status`, `sla_due_at` (created + 36h; `private_info` 2h when it alleges intimate/impersonation content — see 05 §3), `actioned_by`, `actioned_at`, `resolution_note ≤500`, `created_at`, `closed_at` optional. Indexes: `{status:1, sla_due_at:1}` · `{target_id:1, created_at:-1}` · `{masjid_id:1, created_at:-1}` · `{device_id:1}` partial. Rate-limited per device.
**grievances**: `_id`, `public_ref` unique (e.g. `GR-2026-000123`), `category` enum `privacy|content|technical|feedback|other`, `description ≤2000`, `contact_enc` optional (encrypted, same `v1:<keyId>:…` format — replaces the old `contact_key_id` column), `status grievance_status`, `ack_due_at` (24h), `resolve_due_at` (per 05 §3), `acknowledged_at`, `resolved_at`, `resolution ≤2000`, `handled_by`, `created_at`. Index `{status:1, ack_due_at:1}`.
**grievance_seq**: `_id` = year (e.g. `"2026"`), `seq long` — `findOneAndUpdate({$inc:{seq:1}}, {upsert:true})` produces sequential references per year.
**legal_orders**: `_id`, `authority ≤200`, `reference_no ≤120`, `received_at`, `due_at` (received + 3h), `target_type`, `target_id`, `summary ≤2000`, `action_taken ≤2000`, `action_log [{at, by, note ≤500}]` ≤ 200, `status legal_order_status`, `document_key` optional (private bucket), `handled_by`, timestamps. Index `{status:1, due_at:1}`.
**audit_log**: `_id` **ObjectId** (ordered), `at Date`, `actor_type actor_type`, `actor_id` UUID optional, `action string ≤80` (dot-namespaced, e.g. `item.publish`, `payment.approve`, `session.revoke`), `masjid_id` optional, `target_type ≤40`, `target_id ≤64`, `meta` object (≤ 4 KB, no secrets/PII — allow-listed keys per action), `request_id ≤64`. **Append-only**: no user except `mc_system` has `update`/`remove` privileges on this collection (§4.3); only the retention job deletes entries older than retention and records the purge as a new audit entry. Indexes: `{at:-1}` · `{masjid_id:1, at:-1}` · `{actor_id:1, at:-1}` · `{action:1, at:-1}`.
**app_settings**: single document `_id: "global"`: `global_hijri_offset int −2..2`, `maintenance_banner {en,hi,ur,te}` optional, `incident_banner {en,hi,ur,te}` optional, `default_push_quota`, `default_video_quota_bytes`, `undertaking_version`, `privacy_version`, `terms_version`, `push_paused bool default false`, `admin_read_only bool default false`, `report_autohide_threshold int default 10`, `grievance_officer {name, email, address, city}`, `support_whatsapp` optional, `min_client_version`, `updated_by`, `updated_at`. Public fields (exposed via `/config` through the `v_pub_settings` view): hijri offset, banners, legal versions, grievance officer, min client version.
**stats_snapshots**: `_id` = ISO hour string, aggregate counts computed hourly by the worker (masjids by status, devices by platform/locale/push status, follows, push success 24h, storage) — Super Admin Stats reads this instead of scanning large collections.
**_migrations** (runner): `_id` = migration id, `checksum`, `applied_at`, `duration_ms`; plus a lock document `_id: "__lock"` with `locked_until`.

## 3. Data-layer operations that replace SQL helper/state functions
All live in `packages/db/src/` and are the **only** way to perform these changes. Each runs in a transaction and writes `audit_log` in that same transaction.
- **Scope helpers** (replace `app.current_admin_id()`, `app.is_super_admin()`, `app.is_masjid_admin()`, `app.current_device_id()`): the API builds a typed `Scope` from the authenticated session/device **after** loading memberships from `masjid_admins` + `admin_users.status = 'active'`; repositories read only from the scope object, never from request input.
- `bumpMasjidVersion(masjidId, session)` — `$inc content_version`; called by `contentWrite()` (§5).
- `genFollowCode()` — random 40-bit Crockford code; insert retried (max 5) on duplicate-key error.
- State functions (only path to mutate sensitive state): `requestPaymentChange`, `approvePaymentChange`, `rejectPaymentChange`, `activateDuePaymentProfiles` (system), `removeItem` (super), `restoreItem` (super), `suspendMasjid` / `unsuspendMasjid` / `activateMasjid` / `deleteMasjid` (super), `recordAmeen(duaItemId)` (device), `consumeInvite(tokenHash)`, `followMasjid` / `unfollowMasjid` (device), `deleteDevice` (device/system), `setShowChanda` (admin), `setDevicePush` / `setDevicePrefs` (device).
- Each function asserts the scope (e.g. `approvePaymentChange` requires `superScope` with a fresh step-up flag passed from the API) and throws `PolicyDeniedError` otherwise.

## 4. Authorization (replaces RLS — DECISIONS #20)

### 4.1 Policy matrix (layer 2 — enforced by `packages/db/src/policy.ts` on every repository call)
S = find, I = insert, U = update, D = delete. "own" = scope's device / scope's masjids. A cell not listed = **deny**.

| Collection | public (api-public, anonymous) | device | masjid_admin | super_admin |
|---|---|---|---|---|
| masjids | S via `v_pub_masjids` (`status='active'`, not deleted; public fields only) and `v_pub_masjid_status` | – | S own; U own **only fields** `photo_key, photo_thumbhash, show_chanda, chanda_week_start, ramadan_*, *_precaution_min, hijri_offset` | S/I/U all (status changes only via state functions) |
| masjid_stats | – | U (`$inc followers` via follow/unfollow only) | S own | S all |
| admin_users | – | – | S self + co-admins of own masjids (fields: `display_name, role, status`); U self (`display_name`, `ui_locale`) | S/I/U all (phone decrypt only via ★ endpoint) |
| masjid_admins | – | – | S own masjids | S/I/D all |
| webauthn_credentials, admin_invites, admin_sessions | – | – | – (only via auth service functions acting for the authenticated admin) | S (never `public_key`, `token_hash`); revoke via functions |
| masjid_timings, special_timings | S via `v_pub_timings` / `v_pub_special_timings` (visible masjids) | – | S/I/U/D own | all |
| items | S via `v_pub_items` (`status='published'` and masjid visible; audience filtering is done in the query, not the policy — DECISIONS #3; private dua names removed) | – | S own (all statuses; `removed` items: body/title/image hidden); I/U own; "D" = status→deleted via U | all |
| ameens, ameen_counters | S counters | I own (via `recordAmeen`); D own (device deletion) | S counters own | S aggregate |
| campaign_amount_history | – | – | S/I own | S |
| chanda_weeks | S via `v_pub_chanda_weeks` (`visible` and masjid visible) | – | S/I/U own | all |
| content_library | S via `v_pub_library` (`verified`) | – | S verified | all |
| notice_templates | S via `v_pub_templates` (active) | – | S active non-system | all |
| payment_profiles | S via `v_pub_payment_profiles` (`active`; `vpa`, `payee_name`, `effective_at` only) | – | S own; I own via `requestPaymentChange` only | S all; U via state functions only |
| devices | – | S/U/D own (`_id = scope.deviceId`); I via registration | – | S aggregate only via `stats_snapshots` (never endpoints) |
| device_follows | – | S/I/U/D own device | count only via `v_admin_follow_audience` (no device ids) | count only via `v_admin_follow_audience` + `stats_snapshots` |
| notification_jobs, push_quota_usage | – | – | S own masjid | S |
| admin_push_subscriptions | – | – | S/I/D own | S/I/D own |
| reports | – | I | S reports about own masjid (**never** `device_id`) | S/U |
| grievances, grievance_seq | I via `createGrievance` | – | – | S/U (decrypt contact in API with step-up) |
| legal_orders | – | – | – | S/I/U |
| audit_log | – | I (device actions) | S own masjid entries; I | S; I |
| app_settings | S via `v_pub_settings` (public fields) | – | S | S/U |
| stats_snapshots | – | – | – | S |

`hookScope('bunny')` (webhooks) has only: items of `type:'video'` — U `video.*` (status, duration, size, thumbnail, failure reason), item `status` draft → published and `published_at`, `published_version`; masjids — U `video_used_bytes`, `content_version`; notification_jobs — I. `systemScope()` (worker/scripts) has all cells.

Every cell (allowed **and** denied) has a test (10 §1, "Policy matrix"). A generated checklist test asserts the number of (collection × scope × operation) cells equals the number of tests.

### 4.2 Views (read-only, created by migrations; pipelines start with `$match` so indexes are used)
| View | Source | Filter | Exposes |
|---|---|---|---|
| `v_pub_masjids` | masjids | `status:'active', deleted_at` absent | `_id, follow_code, name, name_i18n, area, city, state, address, lat, lng, photo_key, photo_thumbhash, verified_at, calc_method, asr_madhab, hijri_offset, show_chanda, chanda_week_start, ramadan_start, ramadan_end, sehri_precaution_min, iftar_precaution_min, content_version` |
| `v_pub_masjid_status` | masjids | `status ∈ {active, suspended}`, not deleted | `_id, status, content_version` |
| `v_pub_timings` | masjid_timings | `masjid_visible:true` | `_id, prayers, jumuah` |
| `v_pub_special_timings` | special_timings | `masjid_visible:true`, not deleted | public fields |
| `v_pub_items` | items | `status:'published', masjid_visible:true` | everything except `created_by, notify, rights_confirmed, deleted_at, removed_*, purge_after`; `dua.person_name` removed when `dua.name_private` is true |
| `v_pub_chanda_weeks` | chanda_weeks | `visible:true, masjid_visible:true` | `masjid_id, week_start, amount_paise, note` |
| `v_pub_payment_profiles` | payment_profiles | `status:'active', masjid_visible:true` | `masjid_id, vpa, payee_name, effective_at` |
| `v_pub_library` | content_library | `status:'verified'` | content + attribution fields |
| `v_pub_templates` | notice_templates | `status:'active'` (system templates included — musallis need them to render system items such as "Payment details updated"; the admin picker excludes `system:true`) | template fields |
| `v_pub_settings` | app_settings | `_id:'global'` | public fields only |
| `v_admin_follow_audience` | device_follows | – | `masjid_id, muted, push_active, audience_pref` (no `device_id`, no `locale`) |
Tests assert (via `explain`) that the hot view queries (feed page, bundle parts, versions, audience count) use `IXSCAN`.

### 4.3 MongoDB users & privileges (layer 3 — `infra/mongo/roles.ts`)
| Collection / view | `mc_public` | `mc_admin` | `mc_system` | `mc_migrator` |
|---|---|---|---|---|
| all `v_pub_*` views | find | find | find | create/drop views |
| `v_admin_follow_audience` | – | find | find | ″ |
| masjids, masjid_timings, special_timings, items, chanda_weeks, content_library, notice_templates, payment_profiles, admin_users, masjid_admins, webauthn_credentials, admin_invites, admin_sessions, admin_push_subscriptions, notification_jobs, push_quota_usage, legal_orders, app_settings | – | find, insert, update | find, insert, update, remove | collMod, createIndex, createCollection |
| masjid_admins, admin_push_subscriptions | – | + remove | ″ | ″ |
| campaign_amount_history, audit_log | audit_log: insert | **find, insert only** | find, insert, remove (retention only) | ″ |
| reports | insert | find, update | all | ″ |
| grievances | insert | find, update | all | ″ |
| grievance_seq | find, insert, update | – | all | ″ |
| devices, device_follows | find, insert, update, remove | – | all | ″ |
| ameens | insert, remove | – | all | ″ |
| ameen_counters | find, insert, update | find | all | ″ |
| masjid_stats | insert, update | find | all | ″ |
| stats_snapshots | – | find | all | ″ |
| _migrations | – | – | – | all |
DB-privilege tests (`pnpm db:test`) connect **as each user** and assert every forbidden action fails with `Unauthorized` (e.g. `mc_public` reading `items` directly, `mc_admin` updating `audit_log`, `mc_admin` reading `devices`). `pnpm db:verify-roles --env staging` runs the same checks against Atlas.

## 5. Side effects done by the data layer (replace Postgres triggers)
Implemented once in `packages/db/src/effects.ts`, invoked inside the same transaction as the write that causes them. Each has a dedicated test, and a meta-test enumerates every content-writing repository method and asserts it goes through `contentWrite()`.
- **`updated_at`** set on every update; `created_at` on insert.
- **Version bump** (`contentWrite(masjidId, session, fn)`): on any write to items, masjid_timings, special_timings, chanda_weeks, payment_profiles (status change), masjids (public fields) → `$inc masjids.content_version`.
- **Follow limits & counts**: follow = conditional `devices.follow_count` `$inc` where `follow_count < 20` (fails → `FOLLOW_LIMIT_REACHED`), insert follow (duplicate key ⇒ idempotent no-op, counter rolled back by the transaction), `masjid_stats.followers` `$inc`; unfollow/device deletion = reverse.
- **Admin limit**: conditional `masjids.admin_count` `$inc` where `< 5`.
- **Audit immutability**: DB privileges (§4.3) + test.
- **Ameen count**: insert `ameens` (duplicate key ⇒ return current count, no increment) + `$inc ameen_counters.count`.
- **Video usage**: `masjids.video_used_bytes` `$inc` on size set/change; decrement immediately on delete/removal (Phase 6 rule).
- **Purge marker**: `purge_after = now + 180 days` when item status becomes `deleted` or `removed`.
- **Visibility mirror**: masjid status/deletion change → `updateMany` `masjid_visible` on its masjid_timings, special_timings, items, chanda_weeks, payment_profiles.
- **Chanda visibility mirror**: `setShowChanda` → `updateMany` `chanda_weeks.visible`.
- **Device mirror**: device `audience_pref` / `locale` / push status change → `updateMany` the device's follows (≤ 20 docs).
- **Reference & delete rules** (replace Postgres `ON DELETE`): masjids and admin users are never hard-deleted by the app (soft delete / anonymize). Hard deletes happen only in state functions or the retention job, always in a transaction:
  - device deleted (Clear all data or retention) → its `device_follows` and `ameens` deleted, `masjid_stats.followers` decremented, `ameen_counters` kept; `reports.device_id` is `$unset` by the daily `retention` job for reports whose device no longer exists (the public DB user has insert-only access to `reports`, so it can't clear it itself);
  - item purged by retention → its `ameens`, `ameen_counters`, `campaign_amount_history`, linked `chanda_weeks.item_id` (unset) and media (S3/Bunny) removed; `notification_jobs`/`reports`/`audit_log` keep the dangling id until their own retention;
  - admin removed from a masjid → `masjid_admins` document deleted + `admin_count` decremented; admin anonymized → credentials, sessions, invites, push subscriptions deleted;
  - any other dangling reference is a bug: the weekly `counters-reconcile` job also reports orphaned references.
- **Reconciliation**: weekly worker job `counters-reconcile` recomputes `masjid_stats.followers`, `devices.follow_count`, `ameen_counters`, `masjids.admin_count`, `video_used_bytes` and logs/alerts any drift (should be zero).

## 6. Retention (daily worker job `retention`, 03:00 IST, runs with `systemScope()`)
| Data | Keep | Action |
|---|---|---|
| Removed items (moderation) | 180 days after removal (IT Rules preservation) | hard delete + media delete (S3/Bunny) + related ameens/counters |
| Deleted items (by admin) | 180 days | hard delete + media delete |
| Devices with `last_seen_at` > 180 days | – | delete (and its follows; follower counts decremented; its ameens deleted — Ameen counters keep the totals) |
| `reports.device_id` of deleted devices | – | `$unset` daily (05 §1 privacy) |
| Dead push subscriptions | 30 days | `$unset` push fields |
| Admin sessions expired/revoked | 30 days | delete |
| Admin invites used/expired | 30 days | delete |
| Reports | 1 year after close | delete |
| Grievances | 3 years after resolution (owner to confirm with lawyer) | delete |
| Legal orders | 3 years after close (owner to confirm) | delete (+ private document) |
| Audit log | 2 years | delete (audited purge summary) |
| Notification jobs | 90 days | delete |
| Push quota usage | 90 days | delete |
| Campaign amount history | life of campaign + 1 year | delete |
| Removed admin users | 1 year after removal | anonymize (display name → "Removed admin", phone removed, credentials/sessions deleted) |
| Stats snapshots | 2 years | delete |
Batches of ≤ 1,000 documents per operation, looping until done or the time budget ends; `--dry-run` mode reports counts and changes nothing. Application/access logs (outside DB): ≥ 180 days in the S3 log archive (CERT-In, DECISIONS #24).
