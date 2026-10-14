// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Errors from '../src/observability/errors.ts';

// T0.13: browser error reporting is off without a DSN, loads Sentry lazily with every privacy switch off, buffers
// what happens before it loads, and scrubs every event and breadcrumb.

const init = vi.fn();
const captureException = vi.fn();
const captureMessage = vi.fn();
vi.mock('@sentry/browser', () => ({ init, captureException, captureMessage }));

type Module = typeof Errors;
let mod: Module;

beforeEach(async () => {
  vi.resetModules();
  init.mockReset();
  captureException.mockReset();
  captureMessage.mockReset();
  document.head.innerHTML = '<meta name="mc-release" content="abc123">';
  // Run idle work immediately (jsdom has no requestIdleCallback).
  window.requestIdleCallback = (callback: IdleRequestCallback) => {
    callback({ didTimeout: false, timeRemaining: () => 50 });
    return 1;
  }; // test double for the browser API
  mod = await import('../src/observability/errors.ts');
});

afterEach(() => {
  document.head.innerHTML = '';
});

/** Lets pending dynamic imports settle (used where nothing should happen). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Waits until the lazily loaded Sentry module has called init. */
const loaded = () =>
  vi.waitFor(() => {
    expect(init).toHaveBeenCalled();
  });

describe('environmentFor', () => {
  it('maps host names to environments', () => {
    expect(mod.environmentFor('app.localhost')).toBe('local');
    expect(mod.environmentFor('localhost')).toBe('local');
    expect(mod.environmentFor('127.0.0.1')).toBe('local');
    expect(mod.environmentFor('app-staging.almasjids.com')).toBe('staging');
    expect(mod.environmentFor('app.almasjids.com')).toBe('production');
  });
});

describe('startErrorReporting', () => {
  it('without a DSN: off, nothing loaded, reportError is a no-op', async () => {
    expect(mod.startErrorReporting({ dsn: undefined, app: 'app' })).toBe(false);
    expect(mod.startErrorReporting({ dsn: '', app: 'app' })).toBe(false);
    mod.reportError(new Error('x'));
    await flush();
    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('with a DSN: inits Sentry with privacy settings, release from the page, no session tracking', async () => {
    expect(mod.startErrorReporting({ dsn: 'https://key@o1.ingest.example/1', app: 'admin' })).toBe(true);
    await loaded();
    expect(init).toHaveBeenCalledOnce();
    const options = init.mock.calls[0]?.[0] as Record<string, unknown>; // the options object passed to init
    expect(options).toMatchObject({
      dsn: 'https://key@o1.ingest.example/1',
      release: 'abc123',
      environment: 'local',
      initialScope: { tags: { app: 'admin' } },
      sendClientReports: false,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    });
    const integrations = options['integrations'] as (defaults: { name: string }[]) => { name: string }[];
    expect(integrations([{ name: 'Breadcrumbs' }, { name: 'BrowserSession' }]).map((i) => i.name)).toEqual([
      'Breadcrumbs',
    ]);
  });

  it('beforeSend and beforeBreadcrumb scrub', async () => {
    mod.startErrorReporting({ dsn: 'https://key@o1.ingest.example/1', app: 'app' });
    await loaded();
    const options = init.mock.calls[0]?.[0] as {
      beforeSend: (event: object) => object;
      beforeBreadcrumb: (breadcrumb: object) => object;
    };
    expect(options.beforeSend({ message: 'mail me at a@b.co', user: { id: 'x' } })).toEqual({
      message: 'mail me at [email]',
    });
    expect(options.beforeBreadcrumb({ data: { url: 'https://app.test/m/X?code=1' } })).toEqual({
      data: { url: 'https://app.test/m/X' },
    });
  });

  it('buffers errors, rejections, CSP violations and reported errors until Sentry has loaded', async () => {
    let finishIdle: (() => void) | undefined;
    window.requestIdleCallback = (callback: IdleRequestCallback) => {
      finishIdle = () => {
        callback({ didTimeout: false, timeRemaining: () => 50 });
      };
      return 1;
    }; // deferred idle callback
    mod.startErrorReporting({ dsn: 'https://key@o1.ingest.example/1', app: 'app' });
    const boom = new Error('early');
    window.dispatchEvent(new ErrorEvent('error', { error: boom, message: 'early' }));
    const rejection = new Event('unhandledrejection') as Event & { reason: unknown }; // jsdom lacks the class
    rejection.reason = 'rejected';
    window.dispatchEvent(rejection);
    const violation = new Event('securitypolicyviolation') as Event & Record<string, unknown>; // ditto
    Object.assign(violation, { effectiveDirective: 'script-src', blockedURI: 'https://evil.test/x.js' });
    document.dispatchEvent(violation);
    mod.reportError('from a boundary');
    expect(captureException).not.toHaveBeenCalled();

    finishIdle?.();
    await loaded();
    expect(captureException.mock.calls.map(([error]) => error as unknown)).toEqual([
      boom,
      'rejected',
      'from a boundary',
    ]);
    expect(captureMessage).toHaveBeenCalledWith('CSP: script-src blocked https://evil.test/x.js', 'warning');

    // After loading, reported errors go straight to Sentry (its own global handlers replace our early listeners).
    mod.reportError('later');
    expect(captureException).toHaveBeenLastCalledWith('later');
  });

  it('starts only once and falls back to a timer without requestIdleCallback', async () => {
    vi.useFakeTimers();
    // @ts-expect-error — simulating a browser without the API
    delete window.requestIdleCallback;
    mod.startErrorReporting({ dsn: 'https://key@o1.ingest.example/1', app: 'app' });
    expect(mod.startErrorReporting({ dsn: 'https://key@o1.ingest.example/1', app: 'app' })).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    await loaded();
    expect(init).toHaveBeenCalledOnce();
  });
});
