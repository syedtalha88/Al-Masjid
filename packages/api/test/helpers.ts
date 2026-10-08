import { Writable } from 'node:stream';

import { type Logger, pino } from 'pino';

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
