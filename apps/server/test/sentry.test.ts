import { beforeEach, describe, expect, it, vi } from 'vitest';

// T0.13: server Sentry is off without a DSN; with one, every privacy switch is off and events/breadcrumbs/spans are
// scrubbed; reports carry only the request id; shutdown flushes.

const init = vi.fn();
const captureException = vi.fn();
const close = vi.fn(() => Promise.resolve(true));
const setTag = vi.fn();
vi.mock('@sentry/node', () => ({
  init,
  captureException,
  close,
  withScope: (callback: (scope: { setTag: typeof setTag }) => void) => {
    callback({ setTag });
  },
}));

const { sentryInitOptions, startServerSentry, TRACES_SAMPLE_RATE } = await import('../src/sentry.ts');

const base = { release: 'abc', environment: 'staging', process: 'api-admin' } as const;

beforeEach(() => {
  init.mockClear();
  captureException.mockClear();
  close.mockClear();
  setTag.mockClear();
});

describe('startServerSentry', () => {
  it('no DSN → off, Sentry never initialised', () => {
    expect(startServerSentry({ ...base, dsn: undefined })).toBeUndefined();
    expect(startServerSentry({ ...base, dsn: '' })).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
  });

  it('with a DSN → init with privacy settings, process name instead of host name, 5 % traces', () => {
    const sentry = startServerSentry({ ...base, dsn: 'https://k@o1.ingest.example/2' });
    expect(sentry).toBeDefined();
    expect(init).toHaveBeenCalledOnce();
    expect(init.mock.calls[0]?.[0]).toMatchObject({
      dsn: 'https://k@o1.ingest.example/2',
      release: 'abc',
      environment: 'staging',
      serverName: 'api-admin',
      initialScope: { tags: { process: 'api-admin' } },
      sampleRate: 1,
      tracesSampleRate: TRACES_SAMPLE_RATE,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    });
    expect(TRACES_SAMPLE_RATE).toBe(0.05);
  });

  it('report tags the request id and captures; flush closes with a 2 s timeout', async () => {
    const sentry = startServerSentry({ ...base, dsn: 'https://k@o1.ingest.example/2' });
    const error = new Error('db down');
    sentry?.report(error, { requestId: 'req-1' });
    sentry?.report(error);
    expect(setTag).toHaveBeenCalledExactlyOnceWith('request_id', 'req-1');
    expect(captureException).toHaveBeenCalledTimes(2);
    await sentry?.flush();
    expect(close).toHaveBeenCalledWith(2000);
  });
});

describe('sentryInitOptions hooks', () => {
  const options = sentryInitOptions({ ...base, dsn: 'https://k@o1.ingest.example/2' });

  it('beforeSend, beforeBreadcrumb and beforeSendSpan all scrub', () => {
    expect(options.beforeSend({ message: 'user a@b.co', user: { id: 'x' } })).toEqual({ message: 'user [email]' });
    expect(options.beforeBreadcrumb({ data: { url: 'https://h.test/p?token=1' } })).toEqual({
      data: { url: 'https://h.test/p' },
    });
    expect(options.beforeSendSpan({ span_id: 'f'.repeat(16), name: 'GET /m/9876543210' })).toEqual({
      span_id: 'f'.repeat(16),
      name: 'GET /m/[phone]',
    });
  });
});
