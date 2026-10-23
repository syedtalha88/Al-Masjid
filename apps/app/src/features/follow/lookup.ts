// Looking a masjid up by follow code (03 §3 `GET /masjids/resolve/:code`) and turning failures into what the screens
// say: not found (unknown or malformed code, unlisted masjid), offline, or anything else.
import { NetworkError, ProblemError } from '@mc/shared/http';

export type LookupFailure = 'not-found' | 'offline' | 'failed';

/** What went wrong with a resolve call. */
export function lookupFailure(error: unknown, online: boolean = navigator.onLine): LookupFailure {
  if (error instanceof ProblemError && (error.status === 404 || error.problem.code === 'VALIDATION_FAILED')) {
    return 'not-found';
  }
  if (!online || (error instanceof NetworkError && error.reason !== 'aborted')) return 'offline';
  return 'failed';
}

/** Query key of a resolved code (shared by the scanner, the code sheet and the landing). */
export const resolveKey = (code: string) => ['resolve', code] as const;
