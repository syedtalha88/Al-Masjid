// The device store (T2.3, 01 §3 `lib/device`, 04 §4/§11): everything the musalli app keeps on the phone — device
// credentials (IndexedDB, never localStorage), language, brother/sister choice, accepted privacy version, follows in the
// user's order with their sync state, unseen markers, saved items, Ameens said, settings. One schema-versioned
// document, validated on every read (04 §11): data that does not parse is migrated or reset — never trusted.
import { isLocale, type Locale } from '@mc/i18n/locales';
import { publicIdText, uuidText } from '@mc/shared/contracts/public';
import * as z from 'zod/mini';

import { DEVICE_KEY } from '../sw-protocol.ts';

export const DEVICE_STATE_VERSION = 1;
/** 00 §4.1 — the server enforces it too. */
export const MAX_FOLLOWS = 20;
const MAX_SAVED = 500;
const MAX_AMEENS = 2000;

const LOCALE = z.enum(['en', 'hi', 'ur', 'te']);
const credentialsSchema = z.object({
  deviceId: uuidText,
  secret: z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/)),
});
const instant = z.iso.datetime();

/**
 * A followed masjid: `synced` matches the server; `follow` / `unfollow` are queued changes not yet sent (offline, or
 * the device is not registered yet).
 */
const followSchema = z.object({
  masjidId: uuidText,
  followedAt: instant,
  muted: z.boolean(),
  sync: z.enum(['synced', 'follow', 'unfollow']),
});
export type LocalFollow = z.infer<typeof followSchema>;

const stateSchema = z.object({
  version: z.literal(DEVICE_STATE_VERSION),
  /** Returned once by `POST /devices` (03 §1); absent until registration succeeds. */
  credentials: z.optional(credentialsSchema),
  /** Language / brother-sister changed while the server could not be told (Settings, T2.12): sent on the next sync. */
  prefsPending: z.optional(z.boolean()),
  /**
   * "Clear all data" while offline (05 §4 "works offline-queued"): the old device's credentials, kept only until its
   * server record is deleted. Nothing else of the old device remains.
   */
  pendingDeletion: z.optional(credentialsSchema),
  locale: LOCALE,
  audiencePref: z.optional(z.enum(['brothers', 'sisters'])),
  /** Privacy notice version accepted on onboarding page 4 (05 §2). */
  privacyVersion: z.optional(z.string().check(z.maxLength(20))),
  onboardedAt: z.optional(instant),
  /** Registration is owed (offline at "Continue", or the server forgot the device). */
  registrationPending: z.boolean(),
  follows: z.array(followSchema).check(z.maxLength(MAX_FOLLOWS * 2)),
  /** Updates tab: items newer than this are unseen (07 A13). */
  updatesSeenAt: z.optional(instant),
  saved: z.array(z.object({ publicId: publicIdText, savedAt: instant })).check(z.maxLength(MAX_SAVED)),
  /** Dua requests this device said Ameen on (button state), and those still to be sent (08 §5.6). */
  ameens: z.array(publicIdText).check(z.maxLength(MAX_AMEENS)),
  pendingAmeens: z.array(publicIdText).check(z.maxLength(MAX_AMEENS)),
  settings: z.object({
    /** 08 §7 — Android haptics (F16). */
    vibration: z.boolean(),
    /** Read Full reader Arabic size factor (07 A8 A−/A+). */
    arabicScale: z.number().check(z.minimum(0.8), z.maximum(1.6)),
    transliteration: z.boolean(),
  }),
});
export type DeviceState = z.infer<typeof stateSchema>;

/** A fresh state (first launch, or after a reset). */
export function initialDeviceState(locale: Locale): DeviceState {
  return {
    version: DEVICE_STATE_VERSION,
    locale,
    registrationPending: false,
    follows: [],
    saved: [],
    ameens: [],
    pendingAmeens: [],
    settings: { vibration: true, arabicScale: 1, transliteration: true },
  };
}

/**
 * Reads a stored value of any age: the current version is validated; anything else (unknown version, corrupt or
 * tampered data) becomes a fresh state that keeps only a valid locale — the app then onboards again (04 §11).
 *
 * @returns the state and whether it had to be reset.
 */
export function migrateDeviceState(raw: unknown, fallbackLocale: Locale): { state: DeviceState; reset: boolean } {
  if (raw === undefined) return { state: initialDeviceState(fallbackLocale), reset: false };
  const parsed = stateSchema.safeParse(raw);
  if (parsed.success) return { state: parsed.data, reset: false };
  const locale =
    typeof raw === 'object' && raw !== null && 'locale' in raw && isLocale(raw.locale) ? raw.locale : fallbackLocale;
  return { state: initialDeviceState(locale), reset: true };
}

/** Where the document lives: IndexedDB in the app, memory in tests / private mode. */
export interface KeyValueBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /** Every stored entry (the query cache restores from these). */
  entries(): Promise<readonly (readonly [string, unknown])[]>;
  setMany(entries: readonly (readonly [string, unknown])[]): Promise<void>;
  delMany(keys: readonly string[]): Promise<void>;
}

/** An in-memory backend (tests; fallback when IndexedDB is unavailable — 00 §7 "app still works without persistence"). */
export function memoryBackend(initial: Readonly<Record<string, unknown>> = {}): KeyValueBackend {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    get: (key) => Promise.resolve(structuredClone(values.get(key))),
    set: (key, value) => {
      values.set(key, structuredClone(value));
      return Promise.resolve();
    },
    del: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    entries: () => Promise.resolve([...values].map(([key, value]) => [key, structuredClone(value)] as const)),
    setMany: (entries) => {
      for (const [key, value] of entries) values.set(key, structuredClone(value));
      return Promise.resolve();
    },
    delMany: (keys) => {
      for (const key of keys) values.delete(key);
      return Promise.resolve();
    },
  };
}

/** The follows the user sees (pending unfollows hidden), in their order. */
export const visibleFollows = (follows: readonly LocalFollow[]): LocalFollow[] =>
  follows.filter((follow) => follow.sync !== 'unfollow');

/** Shared with the service worker, which reads queued Ameens (Background Sync). */
const STATE_KEY = DEVICE_KEY;

export interface DeviceStore {
  /** The current state (after `load()`); a fresh state before. */
  readonly current: () => DeviceState;
  /** Reads (and if needed migrates/resets) the stored document. Safe to call again. */
  readonly load: () => Promise<{ state: DeviceState; reset: boolean }>;
  /** Applies a change and persists it; changes are serialized, so concurrent updates never lose each other. */
  readonly update: (change: (state: DeviceState) => DeviceState) => Promise<DeviceState>;
  /** Clear all data (05 §4): a fresh state in the current locale. */
  readonly clear: () => Promise<DeviceState>;
  readonly subscribe: (listener: () => void) => () => void;
  /** False when the backend failed (private mode, storage full): the app keeps working in memory. */
  readonly persistent: () => boolean;
}

/**
 * Creates the store over a backend. Writes that fail switch the store to memory-only (`persistent()` false) instead of
 * failing the app.
 */
export function createDeviceStore(backend: KeyValueBackend, fallbackLocale: Locale): DeviceStore {
  let state = initialDeviceState(fallbackLocale);
  let persistent = true;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: DeviceState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const save = async (next: DeviceState) => {
    try {
      await backend.set(STATE_KEY, next);
    } catch {
      persistent = false;
    }
  };
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    current: () => state,
    persistent: () => persistent,
    load: () =>
      serial(async () => {
        let raw: unknown;
        try {
          raw = await backend.get(STATE_KEY);
        } catch {
          persistent = false;
        }
        const result = migrateDeviceState(raw, fallbackLocale);
        if (result.reset) await save(result.state);
        publish(result.state);
        return result;
      }),
    update: (change) =>
      serial(async () => {
        const next = change(state);
        // Validate, but keep the candidate: parsing returns a deep copy, and fresh references for unchanged parts
        // (the follows) would re-render every screen subscribed to them (T2.10 fling trace).
        stateSchema.parse(next);
        await save(next);
        publish(next);
        return next;
      }),
    clear: () =>
      serial(async () => {
        const next = initialDeviceState(state.locale);
        try {
          await backend.del(STATE_KEY);
        } catch {
          persistent = false;
        }
        publish(next);
        return next;
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
