// WebAuthn challenges (04 §3): 32 random bytes, 5-minute TTL, bound to a purpose and to what they were issued for
// (the invite, the login cookie, the session), deleted on first use — Redis `GETDEL`, so a replayed response finds no
// challenge. Keys live under `chal:` (the api-admin ACL user's prefix, 04 §12.2); the binding is hashed.
import { createHash, randomBytes } from 'node:crypto';

import type { Clock } from '@mc/shared/clock';
import type { Redis } from 'ioredis';

export type ChallengePurpose = 'register' | 'login' | 'step_up';
export const CHALLENGE_TTL_SEC = 300;

export interface ChallengeStore {
  /** Stores a new challenge for (purpose, binding), replacing any previous one; returns it (base64url). */
  issue(purpose: ChallengePurpose, binding: string): Promise<string>;
  /** Returns and deletes the challenge for (purpose, binding); `undefined` if none, expired or already used. */
  take(purpose: ChallengePurpose, binding: string): Promise<string | undefined>;
}

const keyOf = (purpose: ChallengePurpose, binding: string) =>
  `chal:${purpose}:${createHash('sha256').update(binding).digest('base64url')}`;
const newChallenge = () => randomBytes(32).toString('base64url');

/** Redis challenge store (api-admin). */
export function redisChallengeStore(redis: Redis): ChallengeStore {
  return {
    async issue(purpose, binding) {
      const challenge = newChallenge();
      await redis.set(keyOf(purpose, binding), challenge, 'EX', CHALLENGE_TTL_SEC);
      return challenge;
    },
    async take(purpose, binding) {
      return (await redis.getdel(keyOf(purpose, binding))) ?? undefined;
    },
  };
}

/** In-memory challenge store for unit tests (same semantics, clock-controlled expiry). */
export function memoryChallengeStore(clock: Clock): ChallengeStore {
  const entries = new Map<string, { challenge: string; expiresAt: number }>();
  return {
    issue(purpose, binding) {
      const challenge = newChallenge();
      entries.set(keyOf(purpose, binding), { challenge, expiresAt: clock.now().getTime() + CHALLENGE_TTL_SEC * 1000 });
      return Promise.resolve(challenge);
    },
    take(purpose, binding) {
      const key = keyOf(purpose, binding);
      const entry = entries.get(key);
      entries.delete(key);
      return Promise.resolve(entry && entry.expiresAt > clock.now().getTime() ? entry.challenge : undefined);
    },
  };
}
