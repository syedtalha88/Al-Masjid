// The dev / staging seed (PHASE_02 T2.2): fake masjids, placeholder library, templates and items from `@mc/db/seed`,
// written as the system (mc_system user — 02 §4.3). Run by `pnpm db:reset` locally and by the worker image on
// staging; refuses production outright (10 §5: dev fixtures never reach production data).
import { type DbHandle, scoped, systemScope } from '@mc/db';
import { buildDevSeed, SEED_FOLLOW_CODES, writeDevSeed } from '@mc/db/seed';
import { calendarDateInZone } from '@mc/domain/time';

/**
 * Writes the seed relative to `now` (idempotent: the same documents are replaced, masjid versions move on).
 *
 * @param appEnv - `local` or `staging`; anything else is refused.
 * @returns how many documents were written.
 * @throws Error in production (or any unknown environment).
 */
export async function runDevSeed(handle: DbHandle, appEnv: string, now: Date): Promise<number> {
  if (appEnv !== 'local' && appEnv !== 'staging') throw new Error(`the dev seed never runs in ${appEnv}`);
  return writeDevSeed(handle, systemScope(), buildDevSeed({ now, today: calendarDateInZone(now) }));
}

/** The staging seed is rewritten when it is older than this: its Ramadan / Eid / "2 hours ago" dates follow `now`. */
export const SEED_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Staging worker (PHASE_02 T2.2, DECISIONS #91): writes the seed when it is missing or older than a day, so the owner's
 * phone checks always see an Eid card, a Ramadan card and recent updates. Never deletes anything else.
 *
 * @returns `written` or `fresh` (nothing to do).
 * @throws Error outside local/staging.
 */
export async function ensureDevSeed(handle: DbHandle, appEnv: string, now: Date): Promise<'written' | 'fresh'> {
  if (appEnv !== 'local' && appEnv !== 'staging') throw new Error(`the dev seed never runs in ${appEnv}`);
  const masjid = await scoped({ scope: systemScope(), db: await handle.db() }, 'masjids').findOne({
    follow_code: SEED_FOLLOW_CODES.alpha,
  });
  const updated: unknown = masjid?.['updated_at'];
  if (updated instanceof Date && now.getTime() - updated.getTime() < SEED_REFRESH_MS) return 'fresh';
  await runDevSeed(handle, appEnv, now);
  return 'written';
}
