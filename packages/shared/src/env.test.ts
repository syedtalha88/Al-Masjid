import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EnvError,
  type EnvSource,
  findForbiddenVars,
  loadServerEnv,
  parseClientEnv,
  SERVER_PROCESSES,
  type ServerProcess,
} from './env.ts';

// ---------------------------------------------------------------------------------------------------
// Fixtures (fake values only — never real credentials)
// ---------------------------------------------------------------------------------------------------

const b64 = (bytes: number, fill: number) => Buffer.alloc(bytes, fill).toString('base64');
const b64url = (buffer: Buffer) => buffer.toString('base64url');

const KEY_32 = b64(32, 7);
const VAPID_PUBLIC = b64url(Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)]));
const VAPID_PRIVATE = b64url(Buffer.alloc(32, 3));

const LOCAL_COMMON = {
  NODE_ENV: 'development',
  APP_ENV: 'local',
  MONGODB_DB_NAME: 'masjid_connect_dev',
  APP_ORIGIN: 'http://localhost:5173',
  ADMIN_ORIGIN: 'http://localhost:5174',
  MEDIA_ORIGIN: 'http://localhost:8790',
  TRUSTED_PROXY_MODE: 'none',
};

const LOCAL: Record<ServerProcess, Record<string, string>> = {
  'api-public': {
    ...LOCAL_COMMON,
    MONGODB_URI_PUBLIC: 'mongodb://mc_public:fake-pw@localhost:27017/?replicaSet=rs0',
    REDIS_URL_PUBLIC: 'redis://rl_public:fake-pw@localhost:6379',
    PORT: '8787',
  },
  'api-admin': {
    ...LOCAL_COMMON,
    MONGODB_URI_ADMIN: 'mongodb://mc_admin:fake-pw@localhost:27017/?replicaSet=rs0',
    REDIS_URL_ADMIN: 'redis://admin:fake-pw@localhost:6379',
    SESSION_PEPPER: KEY_32,
    FIELD_ENCRYPTION_KEY: KEY_32,
    FIELD_ENCRYPTION_KEY_ID: 'k1',
    RP_ID: 'localhost',
    VAPID_PUBLIC_KEY: VAPID_PUBLIC,
    PAYMENT_HOLD_MINUTES: '2',
    PORT: '8788',
  },
  worker: {
    ...LOCAL_COMMON,
    MONGODB_URI_SYSTEM: 'mongodb://mc_system:fake-pw@localhost:27017/?replicaSet=rs0',
    REDIS_URL_WORKER: 'redis://worker:fake-pw@localhost:6379',
    FIELD_ENCRYPTION_KEY: KEY_32,
    FIELD_ENCRYPTION_KEY_ID: 'k1',
    VAPID_PUBLIC_KEY: VAPID_PUBLIC,
    VAPID_PRIVATE_KEY: VAPID_PRIVATE,
    VAPID_SUBJECT: 'mailto:owner@example.com',
    PAYMENT_HOLD_MINUTES: '2',
  },
  migrate: {
    NODE_ENV: 'development',
    APP_ENV: 'local',
    MONGODB_DB_NAME: 'masjid_connect_dev',
    MONGODB_URI_MIGRATOR: 'mongodb://mc_migrator:fake-pw@localhost:27017/?replicaSet=rs0',
  },
};

const PROD_COMMON = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  MONGODB_DB_NAME: 'masjid_connect',
  APP_ORIGIN: 'https://app.example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  MEDIA_ORIGIN: 'https://media.example.com',
  TRUSTED_PROXY_MODE: 'cloudflare',
};
const ATLAS = (user: string) => `mongodb+srv://${user}:fake-pw@cluster0.example.mongodb.net/?retryWrites=true`;
const S3 = { S3_REGION: 'ap-south-1', S3_MEDIA_BUCKET: 'mc-media', S3_PRIVATE_BUCKET: 'mc-private' };
const BUNNY = { BUNNY_LIBRARY_ID: '12345', BUNNY_API_KEY: 'fake-bunny-api-key' };

const PRODUCTION: Record<ServerProcess, Record<string, string>> = {
  'api-public': {
    ...PROD_COMMON,
    MONGODB_URI_PUBLIC: ATLAS('mc_public'),
    REDIS_URL_PUBLIC: 'redis://rl_public:fake-pw@redis:6379',
    TURNSTILE_SECRET: 'fake-turnstile-secret',
    BUNNY_TOKEN_KEY: 'fake-token-key',
    BUNNY_CDN_HOST: 'vz-fake.b-cdn.net',
    PORT: '8787',
  },
  'api-admin': {
    ...PROD_COMMON,
    ...S3,
    ...BUNNY,
    MONGODB_URI_ADMIN: ATLAS('mc_admin'),
    REDIS_URL_ADMIN: 'redis://admin:fake-pw@redis:6379',
    SESSION_PEPPER: KEY_32,
    FIELD_ENCRYPTION_KEY: KEY_32,
    FIELD_ENCRYPTION_KEY_ID: 'k2',
    FIELD_ENCRYPTION_OLD_KEYS: `k1:${b64(32, 1)}`,
    RP_ID: 'admin.example.com',
    BUNNY_TOKEN_KEY: 'fake-token-key',
    BUNNY_WEBHOOK_SECRET: 'fake-webhook-secret',
    BUNNY_CDN_HOST: 'vz-fake.b-cdn.net',
    S3_ACCESS_KEY_ID_ADMIN: 'FAKEACCESSKEYADMIN',
    S3_SECRET_ACCESS_KEY_ADMIN: 'fake-secret-admin',
    TURNSTILE_SECRET: 'fake-turnstile-secret',
    VAPID_PUBLIC_KEY: VAPID_PUBLIC,
    PAYMENT_HOLD_MINUTES: '1440',
    PORT: '8788',
  },
  worker: {
    ...PROD_COMMON,
    ...S3,
    ...BUNNY,
    MONGODB_URI_SYSTEM: ATLAS('mc_system'),
    REDIS_URL_WORKER: 'redis://worker:fake-pw@redis:6379',
    FIELD_ENCRYPTION_KEY: KEY_32,
    FIELD_ENCRYPTION_KEY_ID: 'k2',
    VAPID_PUBLIC_KEY: VAPID_PUBLIC,
    VAPID_PRIVATE_KEY: VAPID_PRIVATE,
    VAPID_SUBJECT: 'mailto:owner@example.com',
    S3_LOG_BUCKET: 'mc-logs',
    S3_ACCESS_KEY_ID_WORKER: 'FAKEACCESSKEYWORKER',
    S3_SECRET_ACCESS_KEY_WORKER: 'fake-secret-worker',
    CF_API_TOKEN_PURGE: 'fake-cf-purge-token',
    CF_ZONE_ID: 'a'.repeat(32),
    PAYMENT_HOLD_MINUTES: '1440',
  },
  migrate: {
    NODE_ENV: 'production',
    APP_ENV: 'production',
    MONGODB_DB_NAME: 'masjid_connect',
    MONGODB_URI_MIGRATOR: ATLAS('mc_migrator'),
  },
};

/** Runs `fn`, asserts it throws EnvError, and returns it. */
function envError(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EnvError);
    return error as EnvError; // asserted on the line above
  }
  throw new Error('expected an EnvError');
}

const reasonFor = (error: EnvError, name: string) => error.problems.find((problem) => problem.name === name)?.reason;

// ---------------------------------------------------------------------------------------------------
// Server processes
// ---------------------------------------------------------------------------------------------------

describe.each(SERVER_PROCESSES)('loadServerEnv(%s)', (process) => {
  it('accepts a complete local env and applies defaults', () => {
    const env = loadServerEnv(process, LOCAL[process]);
    expect(env.APP_ENV).toBe('local');
    expect(env.LOG_LEVEL).toBe('info');
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('accepts a complete production env', () => {
    expect(loadServerEnv(process, PRODUCTION[process]).APP_ENV).toBe('production');
  });

  it('reports every missing variable by name', () => {
    const error = envError(() => loadServerEnv(process, { APP_ENV: 'production' }));
    const missing = error.problems.filter((problem) => problem.reason === 'missing').map((problem) => problem.name);
    const required = Object.keys(PRODUCTION[process]).filter(
      (name) => name !== 'APP_ENV' && name !== 'FIELD_ENCRYPTION_OLD_KEYS',
    );
    expect(missing.sort()).toEqual(required.sort());
    expect(error.message).toContain(`Invalid environment for ${process}`);
  });

  it('never prints values in errors (every variable set to an invalid, marked value)', () => {
    const poisoned: Record<string, string> = { APP_ENV: 'production' };
    for (const [index, name] of Object.keys(PRODUCTION[process]).entries()) {
      if (name !== 'APP_ENV') poisoned[name] = `LEAKCHECK-${String(index)}-%%`;
    }
    const error = envError(() => loadServerEnv(process, poisoned));
    expect(error.problems.length).toBeGreaterThan(0);
    expect(error.message).not.toContain('LEAKCHECK');
    expect(JSON.stringify(error.problems)).not.toContain('LEAKCHECK');
  });
});

describe('forbidden variables (boot refuses to start — DECISIONS #7)', () => {
  const cases: [ServerProcess, string, string][] = [
    ['api-public', 'MONGODB_URI_ADMIN', ATLAS('mc_admin')],
    ['api-admin', 'VAPID_PRIVATE_KEY', VAPID_PRIVATE],
    ['worker', 'SESSION_PEPPER', KEY_32],
    ['migrate', 'MONGODB_URI_SYSTEM', ATLAS('mc_system')],
  ];

  it.each(cases)('%s refuses to boot with %s', (process, name, value) => {
    const error = envError(() => loadServerEnv(process, { ...PRODUCTION[process], [name]: value }));
    expect(error.problems).toEqual([{ name, reason: expect.stringContaining(`forbidden in ${process}`) as unknown }]);
    expect(error.message).not.toContain(value);
  });

  it('matches pattern rules (S3_*_KEY*, FIELD_ENCRYPTION_KEY*) for api-public', () => {
    expect(
      findForbiddenVars('api-public', {
        S3_SECRET_ACCESS_KEY_WORKER: 'x',
        S3_ACCESS_KEY_ID_ADMIN: 'x',
        FIELD_ENCRYPTION_KEY_ID: 'k1',
        S3_REGION: 'ap-south-1',
        PORT: '8787',
      }),
    ).toEqual(['FIELD_ENCRYPTION_KEY_ID', 'S3_ACCESS_KEY_ID_ADMIN', 'S3_SECRET_ACCESS_KEY_WORKER']);
  });

  it('treats an empty-but-present forbidden variable as present', () => {
    expect(findForbiddenVars('worker', { MONGODB_URI_PUBLIC: '' })).toEqual(['MONGODB_URI_PUBLIC']);
    expect(findForbiddenVars('worker', { MONGODB_URI_PUBLIC: undefined })).toEqual([]);
  });

  it('reports forbidden and invalid variables together', () => {
    const error = envError(() =>
      loadServerEnv('api-public', { ...PRODUCTION['api-public'], VAPID_PRIVATE_KEY: 'x', PORT: 'abc' }),
    );
    expect(error.problems.map((problem) => problem.name).sort()).toEqual(['PORT', 'VAPID_PRIVATE_KEY']);
  });

  it('reports forbidden variables even when APP_ENV is missing', () => {
    const error = envError(() => loadServerEnv('api-public', { SESSION_PEPPER: KEY_32 }));
    expect(error.problems.map((problem) => problem.name).sort()).toEqual(['APP_ENV', 'SESSION_PEPPER']);
  });
});

describe('field rules', () => {
  const prodPublic = PRODUCTION['api-public'];
  const prodAdmin = PRODUCTION['api-admin'];
  const prodWorker = PRODUCTION.worker;

  it('rejects an unknown APP_ENV', () => {
    expect(
      reasonFor(
        envError(() => loadServerEnv('migrate', { APP_ENV: 'dev' })),
        'APP_ENV',
      ),
    ).toMatch(/local, staging/);
  });

  it('requires each process to use its own MongoDB user', () => {
    const error = envError(() => loadServerEnv('api-public', { ...prodPublic, MONGODB_URI_PUBLIC: ATLAS('mc_admin') }));
    expect(reasonFor(error, 'MONGODB_URI_PUBLIC')).toMatch(/"mc_public"/);
  });

  it('requires TLS for MongoDB outside local, but not locally', () => {
    const plain = 'mongodb://mc_public:pw@db.example.com:27017/';
    expect(
      reasonFor(
        envError(() => loadServerEnv('api-public', { ...prodPublic, MONGODB_URI_PUBLIC: plain })),
        'MONGODB_URI_PUBLIC',
      ),
    ).toMatch(/TLS/);
    expect(
      loadServerEnv('api-public', { ...prodPublic, MONGODB_URI_PUBLIC: `${plain}?tls=true` }).MONGODB_URI_PUBLIC,
    ).toContain('tls=true');
    expect(() => loadServerEnv('api-public', { ...LOCAL['api-public'], MONGODB_URI_PUBLIC: plain })).not.toThrow();
  });

  it('rejects a non-mongodb URI', () => {
    const error = envError(() =>
      loadServerEnv('migrate', { ...PRODUCTION.migrate, MONGODB_URI_MIGRATOR: 'postgres://x' }),
    );
    expect(reasonFor(error, 'MONGODB_URI_MIGRATOR')).toMatch(/mongodb:\/\//);
  });

  it('requires each process to use its own Redis ACL user', () => {
    const error = envError(() =>
      loadServerEnv('worker', { ...prodWorker, REDIS_URL_WORKER: 'redis://admin:pw@redis:6379' }),
    );
    expect(reasonFor(error, 'REDIS_URL_WORKER')).toMatch(/"worker"/);
    const wrongScheme = envError(() =>
      loadServerEnv('worker', { ...prodWorker, REDIS_URL_WORKER: 'http://worker:pw@x' }),
    );
    expect(reasonFor(wrongScheme, 'REDIS_URL_WORKER')).toMatch(/redis:\/\//);
  });

  it('enforces the 24 h payment hold only in production', () => {
    const error = envError(() => loadServerEnv('api-admin', { ...prodAdmin, PAYMENT_HOLD_MINUTES: '60' }));
    expect(reasonFor(error, 'PAYMENT_HOLD_MINUTES')).toMatch(/1440/);
    const staging = { ...prodAdmin, APP_ENV: 'staging', PAYMENT_HOLD_MINUTES: '5' };
    expect(loadServerEnv('api-admin', staging).PAYMENT_HOLD_MINUTES).toBe(5);
    expect(
      reasonFor(
        envError(() => loadServerEnv('api-admin', { ...staging, PAYMENT_HOLD_MINUTES: '0' })),
        'PAYMENT_HOLD_MINUTES',
      ),
    ).toMatch(/≥ 1/);
  });

  it('outside local: requires NODE_ENV=production, Cloudflare proxy mode and S3 in ap-south-1', () => {
    expect(
      reasonFor(
        envError(() => loadServerEnv('api-public', { ...prodPublic, NODE_ENV: 'development' })),
        'NODE_ENV',
      ),
    ).toMatch(/production/);
    expect(
      reasonFor(
        envError(() => loadServerEnv('api-public', { ...prodPublic, TRUSTED_PROXY_MODE: 'none' })),
        'TRUSTED_PROXY_MODE',
      ),
    ).toMatch(/cloudflare/);
    expect(
      reasonFor(
        envError(() => loadServerEnv('worker', { ...prodWorker, S3_REGION: 'us-east-1' })),
        'S3_REGION',
      ),
    ).toMatch(/ap-south-1/);
  });

  it('requires RP_ID to match the admin origin hostname', () => {
    const error = envError(() => loadServerEnv('api-admin', { ...prodAdmin, RP_ID: 'app.example.com' }));
    expect(reasonFor(error, 'RP_ID')).toMatch(/ADMIN_ORIGIN/);
  });

  it('origins: https outside local, no path, trailing slash normalised', () => {
    expect(
      reasonFor(
        envError(() => loadServerEnv('api-public', { ...prodPublic, APP_ORIGIN: 'http://app.example.com' })),
        'APP_ORIGIN',
      ),
    ).toMatch(/https/);
    expect(
      reasonFor(
        envError(() => loadServerEnv('api-public', { ...prodPublic, APP_ORIGIN: 'https://app.example.com/x' })),
        'APP_ORIGIN',
      ),
    ).toBeDefined();
    expect(
      reasonFor(
        envError(() => loadServerEnv('api-public', { ...prodPublic, APP_ORIGIN: 'not a url' })),
        'APP_ORIGIN',
      ),
    ).toBeDefined();
    expect(loadServerEnv('api-public', { ...prodPublic, APP_ORIGIN: 'https://app.example.com/' }).APP_ORIGIN).toBe(
      'https://app.example.com',
    );
  });

  it('validates key material sizes', () => {
    const shortKey = envError(() => loadServerEnv('api-admin', { ...prodAdmin, FIELD_ENCRYPTION_KEY: b64(16, 1) }));
    expect(reasonFor(shortKey, 'FIELD_ENCRYPTION_KEY')).toMatch(/exactly 32 bytes/);
    const shortPepper = envError(() => loadServerEnv('api-admin', { ...prodAdmin, SESSION_PEPPER: b64(16, 1) }));
    expect(reasonFor(shortPepper, 'SESSION_PEPPER')).toMatch(/at least 32 bytes/);
    const notBase64 = envError(() => loadServerEnv('api-admin', { ...prodAdmin, SESSION_PEPPER: '!!!not-base64!!!' }));
    expect(reasonFor(notBase64, 'SESSION_PEPPER')).toMatch(/base64/);
    const badPadding = envError(() => loadServerEnv('api-admin', { ...prodAdmin, FIELD_ENCRYPTION_KEY: 'abcde' }));
    expect(reasonFor(badPadding, 'FIELD_ENCRYPTION_KEY')).toMatch(/base64/);
    const badVapid = envError(() =>
      loadServerEnv('worker', { ...prodWorker, VAPID_PUBLIC_KEY: b64url(Buffer.alloc(32, 1)) }),
    );
    expect(reasonFor(badVapid, 'VAPID_PUBLIC_KEY')).toMatch(/65 bytes/);
  });

  it('parses FIELD_ENCRYPTION_OLD_KEYS for rotation and rejects malformed lists', () => {
    expect(loadServerEnv('api-admin', prodAdmin).FIELD_ENCRYPTION_OLD_KEYS).toEqual([{ id: 'k1', key: b64(32, 1) }]);
    for (const bad of ['k1', `k1:${b64(16, 1)}`, `K1:${KEY_32}`, `k1:${KEY_32}:extra`]) {
      const error = envError(() => loadServerEnv('api-admin', { ...prodAdmin, FIELD_ENCRYPTION_OLD_KEYS: bad }));
      expect(reasonFor(error, 'FIELD_ENCRYPTION_OLD_KEYS')).toMatch(/id:base64key/);
    }
  });

  it('validates PORT, hostnames, buckets, zone id, VAPID subject and Sentry DSN', () => {
    const cases: [ServerProcess, Record<string, string>, string][] = [
      ['api-public', { ...prodPublic, PORT: '70000' }, 'PORT'],
      ['api-public', { ...prodPublic, BUNNY_CDN_HOST: 'https://vz.b-cdn.net' }, 'BUNNY_CDN_HOST'],
      ['worker', { ...prodWorker, S3_LOG_BUCKET: 'Bad_Bucket' }, 'S3_LOG_BUCKET'],
      ['worker', { ...prodWorker, CF_ZONE_ID: 'xyz' }, 'CF_ZONE_ID'],
      ['worker', { ...prodWorker, VAPID_SUBJECT: 'owner@example.com' }, 'VAPID_SUBJECT'],
      ['worker', { ...prodWorker, BUNNY_LIBRARY_ID: 'abc' }, 'BUNNY_LIBRARY_ID'],
      ['migrate', { ...PRODUCTION.migrate, SENTRY_DSN: 'http://key@sentry.example.com/1' }, 'SENTRY_DSN'],
      ['migrate', { ...PRODUCTION.migrate, MONGODB_DB_NAME: 'bad name' }, 'MONGODB_DB_NAME'],
      ['migrate', { ...PRODUCTION.migrate, LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
    ];
    for (const [process, source, name] of cases) {
      expect(
        reasonFor(
          envError(() => loadServerEnv(process, source)),
          name,
        ),
        name,
      ).toBeDefined();
    }
    expect(loadServerEnv('api-public', prodPublic).PORT).toBe(8787);
  });

  it('treats a whitespace-only value as missing', () => {
    expect(
      reasonFor(
        envError(() => loadServerEnv('migrate', { ...PRODUCTION.migrate, MONGODB_DB_NAME: '   ' })),
        'MONGODB_DB_NAME',
      ),
    ).toBe('missing');
  });

  it('keeps external-service credentials optional only in local', () => {
    const local = loadServerEnv('worker', LOCAL.worker);
    expect(local.S3_MEDIA_BUCKET).toBeUndefined();
    const { CF_API_TOKEN_PURGE: _omitted, ...withoutPurge } = prodWorker;
    expect(
      reasonFor(
        envError(() => loadServerEnv('worker', withoutPurge)),
        'CF_API_TOKEN_PURGE',
      ),
    ).toBe('missing');
  });
});

// ---------------------------------------------------------------------------------------------------
// Client bundles
// ---------------------------------------------------------------------------------------------------

describe('parseClientEnv', () => {
  const ADMIN_CLIENT: EnvSource = {
    VITE_PUBLIC_API_BASE: '/api/admin',
    VITE_PUBLIC_VAPID_PUBLIC_KEY: VAPID_PUBLIC,
    VITE_PUBLIC_APP_ORIGIN: 'https://app.example.com',
    VITE_PUBLIC_MEDIA_ORIGIN: 'https://media.example.com',
    MODE: 'production',
    DEV: false,
    PROD: true,
    BASE_URL: '/',
    SSR: false,
  };
  const APP_CLIENT: EnvSource = {
    ...ADMIN_CLIENT,
    VITE_PUBLIC_API_BASE: '/api/v1',
    VITE_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAfakeSiteKey',
  };

  it('accepts the musalli app env and ignores Vite built-ins', () => {
    const env = parseClientEnv('app', APP_CLIENT);
    expect(env.VITE_PUBLIC_TURNSTILE_SITE_KEY).toBe('0x4AAAAAAAfakeSiteKey');
    expect(env).not.toHaveProperty('MODE');
  });

  it('accepts the admin env without a Turnstile key', () => {
    expect(parseClientEnv('admin', ADMIN_CLIENT).VITE_PUBLIC_API_BASE).toBe('/api/admin');
  });

  it('requires the Turnstile key for the musalli app', () => {
    const { VITE_PUBLIC_TURNSTILE_SITE_KEY: _omitted, ...rest } = APP_CLIENT;
    const error = envError(() => parseClientEnv('app', rest));
    expect(error.target).toBe('app-client');
    expect(reasonFor(error, 'VITE_PUBLIC_TURNSTILE_SITE_KEY')).toBe('missing');
  });

  it('rejects any VITE_ variable that is not VITE_PUBLIC_ (secret exposure guard)', () => {
    const error = envError(() => parseClientEnv('admin', { ...ADMIN_CLIENT, VITE_SESSION_PEPPER: 'secret-value' }));
    expect(reasonFor(error, 'VITE_SESSION_PEPPER')).toMatch(/VITE_PUBLIC_/);
    expect(error.message).not.toContain('secret-value');
  });

  it('requires a same-origin API base path and https origins', () => {
    expect(
      reasonFor(
        envError(() => parseClientEnv('app', { ...APP_CLIENT, VITE_PUBLIC_API_BASE: 'https://api.example.com' })),
        'VITE_PUBLIC_API_BASE',
      ),
    ).toMatch(/same-origin/);
    expect(
      reasonFor(
        envError(() => parseClientEnv('app', { ...APP_CLIENT, VITE_PUBLIC_MEDIA_ORIGIN: 'http://media.example.com' })),
        'VITE_PUBLIC_MEDIA_ORIGIN',
      ),
    ).toMatch(/https/);
    expect(
      parseClientEnv('app', { ...APP_CLIENT, VITE_PUBLIC_APP_ORIGIN: 'http://localhost:5173' }).VITE_PUBLIC_APP_ORIGIN,
    ).toBe('http://localhost:5173');
  });
});

// ---------------------------------------------------------------------------------------------------
// .env.example stays in sync with the schemas
// ---------------------------------------------------------------------------------------------------

describe('.env.example', () => {
  const documented = new Set(
    readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );

  // RELEASE is baked into the Docker image (never set in env files), so it is intentionally not listed.
  it('documents every server variable', () => {
    const names = new Set([
      ...SERVER_PROCESSES.flatMap((process) => Object.keys(PRODUCTION[process])),
      'LOG_LEVEL',
      'SENTRY_DSN',
      'FIELD_ENCRYPTION_OLD_KEYS',
    ]);
    expect([...names].filter((name) => !documented.has(name))).toEqual([]);
  });

  it('documents every client variable and only VITE_PUBLIC_ client variables', () => {
    const client = [
      'VITE_PUBLIC_API_BASE',
      'VITE_PUBLIC_VAPID_PUBLIC_KEY',
      'VITE_PUBLIC_TURNSTILE_SITE_KEY',
      'VITE_PUBLIC_SENTRY_DSN',
      'VITE_PUBLIC_APP_ORIGIN',
      'VITE_PUBLIC_MEDIA_ORIGIN',
    ];
    expect(client.filter((name) => !documented.has(name))).toEqual([]);
    expect([...documented].filter((name) => name.startsWith('VITE_') && !name.startsWith('VITE_PUBLIC_'))).toEqual([]);
  });

  it('contains no values', () => {
    const withValues = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=.+/.test(line));
    expect(withValues).toEqual([]);
  });
});

describe('RELEASE', () => {
  it('defaults to dev and accepts a git SHA', () => {
    expect(loadServerEnv('migrate', PRODUCTION.migrate).RELEASE).toBe('dev');
    expect(loadServerEnv('migrate', { ...PRODUCTION.migrate, RELEASE: '809eed7' }).RELEASE).toBe('809eed7');
  });

  it('rejects odd characters (it ends up in headers and logs)', () => {
    const error = envError(() => loadServerEnv('migrate', { ...PRODUCTION.migrate, RELEASE: 'v1 <script>' }));
    expect(reasonFor(error, 'RELEASE')).toMatch(/1–64/);
  });
});
