import { Writable } from 'node:stream';

import type { Clock } from '@mc/shared/clock';
import { type Logger, pino } from 'pino';

import { memoryChallengeStore } from '../src/auth/challenges.ts';
import type { AdminPasskeyDeps } from '../src/routes/admin-passkeys.ts';

/** A logger that captures JSON lines in memory for assertions. */
export function captureLogger(): { logger: Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = pino({ level: 'debug' }, destination);
  return {
    logger,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>), // pino writes JSON lines
  };
}

export const silentLogger = (): Logger => pino({ level: 'silent' });

/** The passkey routes' dependencies for tests: RP = the test admin origin, in-memory challenges on the test clock. */
export function passkeyDeps(origin: string, clock: Clock, logger: Logger = silentLogger()): AdminPasskeyTestDeps {
  return {
    rp: { id: new URL(origin).hostname, name: 'Test Admin App', origin },
    challenges: memoryChallengeStore(clock),
    logger,
  };
}
export type AdminPasskeyTestDeps = Pick<AdminPasskeyDeps, 'rp' | 'challenges' | 'logger'>;
