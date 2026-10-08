import { type Logger, type LoggerOptions, pino } from 'pino';

/**
 * Paths redacted from every log line (CLAUDE.md §6 Logging, 04 §10). Request/response logging uses
 * allow-list serializers (http/request-logger.ts), so these are a second line of defence for objects
 * logged by hand.
 */
export const REDACT_PATHS = [
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'turnstileToken',
  'subscription',
  'keys',
  'phone',
  'contact',
  '*.authorization',
  '*.cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.turnstileToken',
  '*.subscription',
  '*.keys',
  '*.phone',
  '*.contact',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export interface CreateLoggerOptions {
  /** Process name (`api-public`, `api-admin`, `worker`, `migrate`) — added to every line. */
  readonly process: string;
  readonly level: pino.LevelWithSilentOrString;
  /** Release identifier (git SHA in images, `dev` locally). */
  readonly release: string;
  /** Destination for tests; defaults to stdout. */
  readonly destination?: pino.DestinationStream;
}

/**
 * Creates the structured JSON logger for a server process.
 *
 * @returns a pino logger writing JSON lines to stdout (or `destination`), with secret paths redacted.
 */
export function createLogger({ process, level, release, destination }: CreateLoggerOptions): Logger {
  const options: LoggerOptions = {
    level,
    base: { process, release },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
  return destination ? pino(options, destination) : pino(options);
}
