/**
 * Environment variables for every process (01_ARCHITECTURE §7, DECISIONS #7).
 *
 * Each server process parses its own variable set at boot and refuses to start when a variable is
 * missing, invalid, or **forbidden for that process** (credential split: a compromised `api-public`
 * container must not hold admin/system credentials). Errors list variable *names* only — never values.
 *
 * Uses only platform APIs available in both Node and browsers (no Buffer), so the client parsers can
 * live in the same module.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------------
// Types & errors
// ---------------------------------------------------------------------------------------------------

/** The four server-side processes. */
export const SERVER_PROCESSES = ['api-public', 'api-admin', 'worker', 'migrate'] as const;
export type ServerProcess = (typeof SERVER_PROCESSES)[number];

/** The two browser bundles. */
export const CLIENT_APPS = ['app', 'admin'] as const;
export type ClientApp = (typeof CLIENT_APPS)[number];

/** A raw environment (e.g. `process.env` or `import.meta.env`). */
export type EnvSource = Readonly<Record<string, unknown>>;

export interface EnvProblem {
  /** Variable name. */
  readonly name: string;
  /** Why it was rejected. Never contains the variable's value. */
  readonly reason: string;
}

/** Thrown when an environment is missing variables, has invalid ones, or holds forbidden ones. */
export class EnvError extends Error {
  override readonly name = 'EnvError';
  readonly target: ServerProcess | `${ClientApp}-client`;
  readonly problems: readonly EnvProblem[];

  constructor(target: ServerProcess | `${ClientApp}-client`, problems: readonly EnvProblem[]) {
    super(
      [
        `Invalid environment for ${target} — refusing to start. Problems (names only, values are never printed):`,
        ...problems.map((problem) => `  - ${problem.name}: ${problem.reason}`),
      ].join('\n'),
    );
    this.target = target;
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------------------------------
// Forbidden variables per process (01 §7, last paragraph)
// ---------------------------------------------------------------------------------------------------

type Matcher = string | RegExp;

const FORBIDDEN: Readonly<Record<ServerProcess, readonly Matcher[]>> = {
  'api-public': [
    'MONGODB_URI_ADMIN',
    'MONGODB_URI_SYSTEM',
    'MONGODB_URI_MIGRATOR',
    'BUNNY_API_KEY',
    /^S3_.*_KEY/,
    'VAPID_PRIVATE_KEY',
    'CF_API_TOKEN_PURGE',
    'SESSION_PEPPER',
    /^FIELD_ENCRYPTION_KEY/,
    'FIELD_ENCRYPTION_OLD_KEYS',
  ],
  'api-admin': [
    'MONGODB_URI_SYSTEM',
    'MONGODB_URI_MIGRATOR',
    'MONGODB_URI_PUBLIC',
    'VAPID_PRIVATE_KEY',
    'CF_API_TOKEN_PURGE',
  ],
  worker: ['MONGODB_URI_PUBLIC', 'MONGODB_URI_ADMIN', 'MONGODB_URI_MIGRATOR', 'SESSION_PEPPER'],
  // Not listed in 01 §7; least privilege: the migrator holds only its own DB credential.
  migrate: [
    'MONGODB_URI_PUBLIC',
    'MONGODB_URI_ADMIN',
    'MONGODB_URI_SYSTEM',
    'SESSION_PEPPER',
    'VAPID_PRIVATE_KEY',
    'BUNNY_API_KEY',
    /^S3_.*_KEY/,
    'CF_API_TOKEN_PURGE',
    /^FIELD_ENCRYPTION_KEY/,
    'FIELD_ENCRYPTION_OLD_KEYS',
  ],
};

/**
 * Returns the names of variables present in `source` that `process` must not have.
 * A variable counts as present when the key exists at all, even with an empty value.
 *
 * @param process - the process being booted.
 * @param source - raw environment.
 * @returns sorted list of forbidden variable names found (empty when clean).
 */
export function findForbiddenVars(process: ServerProcess, source: EnvSource): string[] {
  const matchers = FORBIDDEN[process];
  return Object.keys(source)
    .filter((name) => source[name] !== undefined)
    .filter((name) => matchers.some((matcher) => (typeof matcher === 'string' ? matcher === name : matcher.test(name))))
    .sort();
}

// ---------------------------------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------------------------------

const APP_ENVS = ['local', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Decodes standard or URL-safe base64 to its byte length; `null` when not valid base64. */
function base64ByteLength(value: string): number | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  try {
    return atob(padded).length;
  } catch {
    return null;
  }
}

const nonEmpty = z.string().trim().min(1, { error: 'must not be empty' });

const base64Bytes = (bytes: number, exact: boolean) =>
  nonEmpty.refine(
    (value) => {
      const length = base64ByteLength(value);
      return length !== null && (exact ? length === bytes : length >= bytes);
    },
    { error: `must be base64 encoding ${exact ? 'exactly' : 'at least'} ${String(bytes)} bytes` },
  );

const port = z.coerce
  .number({ error: 'must be a port number' })
  .int({ error: 'must be a port number' })
  .min(1, { error: 'must be a port number' })
  .max(65535, { error: 'must be a port number' });

const hostname = nonEmpty.regex(
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i,
  {
    error: 'must be a bare hostname (no scheme, port or path)',
  },
);

/** An origin like `https://app.example.com` (no path). `http` only for localhost-style hosts. */
const origin = (allowHttpAnywhere: boolean) =>
  nonEmpty
    .refine(
      (value) => {
        try {
          const url = new URL(value);
          const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
          const protocolOk =
            url.protocol === 'https:' || (url.protocol === 'http:' && (allowHttpAnywhere || isLocalHost));
          return protocolOk && url.origin === value.replace(/\/$/, '');
        } catch {
          return false;
        }
      },
      {
        error: allowHttpAnywhere
          ? 'must be an origin like https://host (no path)'
          : 'must be an https origin like https://host (no path)',
      },
    )
    .transform((value) => value.replace(/\/$/, ''));

/** `mongodb[+srv]://<user>:<password>@…` with the process's own user; TLS required outside local. */
const mongoUri = (user: string, isLocal: boolean) =>
  nonEmpty
    .regex(/^mongodb(\+srv)?:\/\//, { error: 'must be a mongodb:// or mongodb+srv:// URI' })
    .refine((value) => new RegExp(`^mongodb(\\+srv)?://${user}:[^@/]+@`).test(value), {
      error: `must authenticate as the "${user}" user (one MongoDB user per process — DECISIONS #7)`,
    })
    .refine((value) => isLocal || value.startsWith('mongodb+srv://') || /[?&](tls|ssl)=true(&|$)/.test(value), {
      error: 'must use TLS outside local (mongodb+srv:// or tls=true)',
    });

/** `redis[s]://<acl-user>:<password>@host:port` with the process's own ACL user (04 §12.2). */
const redisUrl = (user: string) =>
  nonEmpty
    .regex(/^rediss?:\/\//, { error: 'must be a redis:// or rediss:// URL' })
    .refine((value) => new RegExp(`^rediss?://${user}:[^@/]+@[^/]+`).test(value), {
      error: `must authenticate as the "${user}" Redis ACL user`,
    });

const s3Bucket = nonEmpty.regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { error: 'must be a valid S3 bucket name' });

/** P-256 public key, uncompressed point, base64url (65 bytes). */
const vapidPublicKey = nonEmpty.refine((value) => base64ByteLength(value) === 65, {
  error: 'must be a base64url VAPID public key (65 bytes)',
});

/** Turns a schema into "required outside local, optional in local" (external services mocked locally — 01 §6). */
const requiredOutsideLocal = <T extends z.ZodType>(schema: T, isLocal: boolean) =>
  isLocal ? schema.optional() : schema;

// ---------------------------------------------------------------------------------------------------
// Server schemas
// ---------------------------------------------------------------------------------------------------

/** Variables every server process has (the migrator needs no origins). */
function baseShape() {
  return {
    NODE_ENV: z.enum(['development', 'test', 'production'], { error: 'must be development, test or production' }),
    APP_ENV: z.enum(APP_ENVS, { error: 'must be local, staging or production' }),
    LOG_LEVEL: z.enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` }).default('info'),
    SENTRY_DSN: z.url({ protocol: /^https$/, error: 'must be an https Sentry DSN' }).optional(),
    MONGODB_DB_NAME: nonEmpty.regex(/^[A-Za-z0-9_-]{1,38}$/, { error: 'must be 1–38 letters, digits, _ or -' }),
    /** Build release (git SHA), baked into the Docker image; `dev` when unset (health, logs, Sentry). */
    RELEASE: nonEmpty
      .regex(/^[A-Za-z0-9._-]{1,64}$/, { error: 'must be 1–64 of A-Z a-z 0-9 . _ -' })
      .optional()
      .default('dev'),
  };
}

/** "Common (all server processes)" in 01 §7. */
function commonShape(isLocal: boolean) {
  return {
    ...baseShape(),
    APP_ORIGIN: origin(isLocal),
    ADMIN_ORIGIN: origin(isLocal),
    MEDIA_ORIGIN: origin(isLocal),
    TRUSTED_PROXY_MODE: z.enum(['cloudflare', 'none'], { error: 'must be cloudflare or none' }),
  };
}

function fieldEncryptionShape() {
  return {
    FIELD_ENCRYPTION_KEY: base64Bytes(32, true),
    FIELD_ENCRYPTION_KEY_ID: nonEmpty.regex(/^[a-z0-9-]{1,32}$/, { error: 'must be 1–32 of a-z, 0-9, -' }),
    /** Previous keys for rotation: `id:base64,id:base64`. */
    FIELD_ENCRYPTION_OLD_KEYS: nonEmpty
      .refine(
        (value) =>
          value.split(',').every((entry) => {
            const [id, key, ...rest] = entry.split(':');
            return (
              rest.length === 0 &&
              id !== undefined &&
              /^[a-z0-9-]{1,32}$/.test(id) &&
              key !== undefined &&
              base64ByteLength(key) === 32
            );
          }),
        { error: 'must be a comma-separated list of id:base64key (32-byte keys)' },
      )
      .transform((value) =>
        value.split(',').map((entry) => {
          const [id = '', key = ''] = entry.split(':');
          return { id, key };
        }),
      )
      .optional(),
  };
}

const paymentHoldMinutes = (isProduction: boolean) =>
  z.coerce
    .number({ error: 'must be a whole number of minutes' })
    .int({ error: 'must be a whole number of minutes' })
    .min(isProduction ? 1440 : 1, { error: isProduction ? 'must be ≥ 1440 (24 h) in production' : 'must be ≥ 1' });

const bunnyLibraryId = nonEmpty.regex(/^\d+$/, { error: 'must be numeric' });

const SERVER_SCHEMAS = {
  'api-public': (appEnv: AppEnv) => {
    const isLocal = appEnv === 'local';
    return z.object({
      ...commonShape(isLocal),
      MONGODB_URI_PUBLIC: mongoUri('mc_public', isLocal),
      REDIS_URL_PUBLIC: redisUrl('rl_public'),
      TURNSTILE_SECRET: requiredOutsideLocal(nonEmpty, isLocal),
      BUNNY_TOKEN_KEY: requiredOutsideLocal(nonEmpty, isLocal),
      BUNNY_CDN_HOST: requiredOutsideLocal(hostname, isLocal),
      PORT: port,
    });
  },
  'api-admin': (appEnv: AppEnv) => {
    const isLocal = appEnv === 'local';
    return z.object({
      ...commonShape(isLocal),
      ...fieldEncryptionShape(),
      MONGODB_URI_ADMIN: mongoUri('mc_admin', isLocal),
      REDIS_URL_ADMIN: redisUrl('admin'),
      SESSION_PEPPER: base64Bytes(32, false),
      RP_ID: hostname,
      BUNNY_LIBRARY_ID: requiredOutsideLocal(bunnyLibraryId, isLocal),
      BUNNY_API_KEY: requiredOutsideLocal(nonEmpty, isLocal),
      BUNNY_TOKEN_KEY: requiredOutsideLocal(nonEmpty, isLocal),
      BUNNY_WEBHOOK_SECRET: requiredOutsideLocal(nonEmpty, isLocal),
      BUNNY_CDN_HOST: requiredOutsideLocal(hostname, isLocal),
      S3_REGION: requiredOutsideLocal(nonEmpty, isLocal),
      S3_MEDIA_BUCKET: requiredOutsideLocal(s3Bucket, isLocal),
      S3_PRIVATE_BUCKET: requiredOutsideLocal(s3Bucket, isLocal),
      S3_ACCESS_KEY_ID_ADMIN: requiredOutsideLocal(nonEmpty, isLocal),
      S3_SECRET_ACCESS_KEY_ADMIN: requiredOutsideLocal(nonEmpty, isLocal),
      TURNSTILE_SECRET: requiredOutsideLocal(nonEmpty, isLocal),
      VAPID_PUBLIC_KEY: vapidPublicKey,
      PAYMENT_HOLD_MINUTES: paymentHoldMinutes(appEnv === 'production'),
      PORT: port,
    });
  },
  worker: (appEnv: AppEnv) => {
    const isLocal = appEnv === 'local';
    return z.object({
      ...commonShape(isLocal),
      ...fieldEncryptionShape(),
      MONGODB_URI_SYSTEM: mongoUri('mc_system', isLocal),
      REDIS_URL_WORKER: redisUrl('worker'),
      VAPID_PUBLIC_KEY: vapidPublicKey,
      VAPID_PRIVATE_KEY: base64Bytes(32, true),
      VAPID_SUBJECT: nonEmpty.regex(/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/, {
        error: 'must be a mailto: or https: contact',
      }),
      BUNNY_LIBRARY_ID: requiredOutsideLocal(bunnyLibraryId, isLocal),
      BUNNY_API_KEY: requiredOutsideLocal(nonEmpty, isLocal),
      S3_REGION: requiredOutsideLocal(nonEmpty, isLocal),
      S3_MEDIA_BUCKET: requiredOutsideLocal(s3Bucket, isLocal),
      S3_PRIVATE_BUCKET: requiredOutsideLocal(s3Bucket, isLocal),
      S3_LOG_BUCKET: requiredOutsideLocal(s3Bucket, isLocal),
      S3_ACCESS_KEY_ID_WORKER: requiredOutsideLocal(nonEmpty, isLocal),
      S3_SECRET_ACCESS_KEY_WORKER: requiredOutsideLocal(nonEmpty, isLocal),
      CF_API_TOKEN_PURGE: requiredOutsideLocal(nonEmpty, isLocal),
      CF_ZONE_ID: requiredOutsideLocal(
        nonEmpty.regex(/^[a-f0-9]{32}$/, { error: 'must be a 32-character hex zone id' }),
        isLocal,
      ),
      PAYMENT_HOLD_MINUTES: paymentHoldMinutes(appEnv === 'production'),
    });
  },
  migrate: (appEnv: AppEnv) =>
    z.object({
      ...baseShape(),
      MONGODB_URI_MIGRATOR: mongoUri('mc_migrator', appEnv === 'local'),
    }),
} as const;

/** Parsed, validated environment of one server process. */
export type ServerEnv<P extends ServerProcess> = z.output<ReturnType<(typeof SERVER_SCHEMAS)[P]>>;

/** Cross-field rules that only make sense on the whole object. */
function crossFieldProblems(env: Record<string, unknown>): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const appEnv = env['APP_ENV'];
  if (appEnv !== 'local') {
    if (env['NODE_ENV'] !== 'production')
      problems.push({ name: 'NODE_ENV', reason: `must be production when APP_ENV=${String(appEnv)}` });
    if ('TRUSTED_PROXY_MODE' in env && env['TRUSTED_PROXY_MODE'] !== 'cloudflare') {
      problems.push({
        name: 'TRUSTED_PROXY_MODE',
        reason: 'must be cloudflare outside local (origin sits behind Cloudflare)',
      });
    }
    if ('S3_REGION' in env && env['S3_REGION'] !== 'ap-south-1') {
      problems.push({ name: 'S3_REGION', reason: 'must be ap-south-1 (data stays in India — DECISIONS #23)' });
    }
  }
  if (typeof env['RP_ID'] === 'string' && typeof env['ADMIN_ORIGIN'] === 'string') {
    if (new URL(env['ADMIN_ORIGIN']).hostname !== env['RP_ID']) {
      problems.push({
        name: 'RP_ID',
        reason: 'must equal the hostname of ADMIN_ORIGIN (passkey relying party — 04 §3)',
      });
    }
  }
  return problems;
}

/**
 * Converts Zod issues into name-only problems. A variable that is absent from `source` is reported as
 * "missing"; otherwise the schema's own message is used (our messages never include values, and Zod 4
 * does not echo input unless `reportInput` is enabled, which we never do).
 */
function toProblems(issues: readonly z.core.$ZodIssue[], source: EnvSource): EnvProblem[] {
  return issues.map((issue) => {
    const name = issue.path.map(String).join('.') || '(root)';
    const raw = source[name];
    const missing = raw === undefined || (typeof raw === 'string' && raw.trim() === '');
    return { name, reason: missing ? 'missing' : issue.message };
  });
}

/**
 * Parses and validates the environment for one server process.
 *
 * Order of checks: (1) forbidden variables for this process, (2) per-variable schema, (3) cross-field
 * rules. All problems found are reported together.
 *
 * @param process - which process is booting.
 * @param source - raw environment, normally `process.env`.
 * @returns the typed, frozen environment.
 * @throws {EnvError} listing every missing / invalid / forbidden variable by name (never by value).
 */
export function loadServerEnv<P extends ServerProcess>(process: P, source: EnvSource): Readonly<ServerEnv<P>> {
  const problems: EnvProblem[] = findForbiddenVars(process, source).map((name) => ({
    name,
    reason: `forbidden in ${process} (this process must not hold this credential — DECISIONS #7)`,
  }));

  const appEnvResult = z.enum(APP_ENVS).safeParse(source['APP_ENV']);
  if (!appEnvResult.success) {
    problems.push({
      name: 'APP_ENV',
      reason: source['APP_ENV'] === undefined ? 'missing' : 'must be local, staging or production',
    });
    throw new EnvError(process, problems);
  }

  // TypeScript cannot correlate `SERVER_SCHEMAS[P]` with `ServerEnv<P>` for a generic P (correlated-union
  // limitation); the map is keyed by process, so the builder for P produces exactly ServerEnv<P>.
  const schema = SERVER_SCHEMAS[process](appEnvResult.data) as unknown as z.ZodType<ServerEnv<P>>;
  const result = schema.safeParse(source);
  if (!result.success) problems.push(...toProblems(result.error.issues, source));
  else problems.push(...crossFieldProblems(result.data));

  if (problems.length > 0 || !result.success) throw new EnvError(process, problems);
  return Object.freeze(result.data);
}

// ---------------------------------------------------------------------------------------------------
// Client (build-time) env — only VITE_PUBLIC_* may reach a bundle (04 §11, CLAUDE.md §8)
// ---------------------------------------------------------------------------------------------------

export const CLIENT_ENV_PREFIX = 'VITE_PUBLIC_';

const apiBase = nonEmpty.regex(/^\/[a-z0-9/_-]*$/, {
  error: 'must be a same-origin path like /api/v1 (APIs are same-origin, no CORS — DECISIONS #6)',
});

const adminClientSchema = z.object({
  VITE_PUBLIC_API_BASE: apiBase,
  // Admins receive alert pushes (01 §5.8 alert-send), so the admin bundle needs the public VAPID key too.
  VITE_PUBLIC_VAPID_PUBLIC_KEY: vapidPublicKey,
  VITE_PUBLIC_SENTRY_DSN: z.url({ protocol: /^https$/, error: 'must be an https Sentry DSN' }).optional(),
  VITE_PUBLIC_APP_ORIGIN: origin(false),
  VITE_PUBLIC_MEDIA_ORIGIN: origin(false),
});

const appClientSchema = adminClientSchema.extend({
  VITE_PUBLIC_TURNSTILE_SITE_KEY: nonEmpty.regex(/^[0-9A-Za-z_-]{10,}$/, { error: 'must be a Turnstile site key' }),
});

export type AppClientEnv = z.output<typeof appClientSchema>;
export type AdminClientEnv = z.output<typeof adminClientSchema>;

/**
 * Validates a client bundle's build-time env (`import.meta.env`).
 *
 * Any `VITE_*` variable that is not `VITE_PUBLIC_*` is rejected so a secret can never be exposed by a
 * prefix mistake; Vite's own `MODE`/`DEV`/`PROD`/`BASE_URL`/`SSR` keys are ignored.
 *
 * @param app - which bundle (`app` = musalli PWA, `admin` = admin PWA).
 * @param source - the raw build env.
 * @returns the typed, frozen client env.
 * @throws {EnvError} listing missing/invalid/non-public variables by name.
 */
export function parseClientEnv(app: 'app', source: EnvSource): Readonly<AppClientEnv>;
export function parseClientEnv(app: 'admin', source: EnvSource): Readonly<AdminClientEnv>;
export function parseClientEnv(app: ClientApp, source: EnvSource): Readonly<AppClientEnv | AdminClientEnv> {
  const target = `${app}-client` as const;
  const problems: EnvProblem[] = Object.keys(source)
    .filter((name) => name.startsWith('VITE_') && !name.startsWith(CLIENT_ENV_PREFIX))
    .sort()
    .map((name) => ({ name, reason: `client variables must start with ${CLIENT_ENV_PREFIX}` }));

  const result = (app === 'app' ? appClientSchema : adminClientSchema).safeParse(source);
  if (!result.success) problems.push(...toProblems(result.error.issues, source));
  if (problems.length > 0 || !result.success) throw new EnvError(target, problems);
  return Object.freeze(result.data);
}
