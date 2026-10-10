// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useServiceWorker } from '../src/pwa/useServiceWorker.ts';
import { headTags, offlineHtml, PRECACHE } from '../src/vite/pwa.ts';

// PHASE_00 T0.11: the update flow of 01 §5.6 and the build-time PWA pieces.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  state: ServiceWorkerState;
  constructor(state: ServiceWorkerState) {
    super();
    this.state = state;
  }
  setState(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  active = new FakeWorker('activated');
  update = vi.fn(() => Promise.resolve());
}

/** Installs a fake `navigator.serviceWorker`; `controlled` = an old worker already controls the page. */
function fakeContainer(registration: FakeRegistration, controlled: boolean) {
  const container = Object.assign(new EventTarget(), {
    controller: controlled ? new FakeWorker('activated') : null,
    register: vi.fn(() => Promise.resolve(registration)),
    ready: Promise.resolve(registration),
  });
  Object.defineProperty(window.navigator, 'serviceWorker', { value: container, configurable: true });
  return container;
}

describe('useServiceWorker (01 §5.6 update flow)', () => {
  it('registers /sw.js, hands the loaded assets to the worker, no update on first install', async () => {
    const registration = new FakeRegistration();
    const container = fakeContainer(registration, false);
    const { result } = renderHook(() => useServiceWorker({ enabled: true }));
    await waitFor(() => {
      expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });
    await waitFor(() => {
      expect(registration.active.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CACHE_URLS', urls: expect.any(Array) as unknown }),
      );
    });
    // A first install (no controller yet) is not an "update".
    const installing = new FakeWorker('installing');
    registration.installing = installing;
    act(() => {
      registration.dispatchEvent(new Event('updatefound'));
      installing.setState('installed');
    });
    expect(result.current.updateAvailable).toBe(false);
  });

  it('a new worker installed under an old one → update available; Refresh → SKIP_WAITING → reload', async () => {
    const registration = new FakeRegistration();
    const container = fakeContainer(registration, true);
    const reload = vi.fn();
    const { result } = renderHook(() => useServiceWorker({ enabled: true, reload }));
    await waitFor(() => {
      expect(container.register).toHaveBeenCalled();
    });
    const next = new FakeWorker('installing');
    registration.installing = next;
    act(() => {
      registration.dispatchEvent(new Event('updatefound'));
      next.setState('installed');
    });
    expect(result.current.updateAvailable).toBe(true);
    // A controller change the user did not ask for never reloads (01 §5.6).
    act(() => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(reload).not.toHaveBeenCalled();
    act(() => {
      result.current.applyUpdate();
    });
    expect(next.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    act(() => {
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a worker already waiting at startup is offered too; checks again when the app returns', async () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('installed');
    fakeContainer(registration, true);
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const { result } = renderHook(() => useServiceWorker({ enabled: true }));
    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });
    vi.spyOn(Date, 'now').mockReturnValue(2 * 60 * 1000);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('disabled (dev builds): never registers', () => {
    const container = fakeContainer(new FakeRegistration(), false);
    renderHook(() => useServiceWorker({ enabled: false }));
    expect(container.register).not.toHaveBeenCalled();
  });
});

describe('PWA build pieces (mcPwa)', () => {
  it('offline page: four languages with their direction, app stylesheet, no inline script or style', () => {
    const html = offlineHtml('app', 'assets/index-abc.css');
    expect(html).toContain('<link rel="stylesheet" href="/assets/index-abc.css" />');
    for (const [locale, dir] of [
      ['en', 'ltr'],
      ['hi', 'ltr'],
      ['ur', 'rtl'],
      ['te', 'ltr'],
    ]) {
      expect(html).toContain(`lang="${String(locale)}" dir="${String(dir)}"`);
    }
    expect(html).not.toMatch(/<script|<style|\sstyle=/);
    expect(offlineHtml('admin', undefined)).toContain('<title>Masjid Connect Admin</title>');
  });

  it('head tags: manifest, favicon, Apple tags and ten launch screens', () => {
    const tags = headTags('app');
    expect(tags).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(tags).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(tags).toContain('content="Masjid"');
    expect(tags.match(/apple-touch-startup-image/g)).toHaveLength(10);
    expect(headTags('admin')).toContain('content="Masjid Admin"');
  });

  it('precache = the shell: per-locale chunks, script fonts, maps and launch screens are left out', () => {
    expect(PRECACHE.globIgnores).toEqual(
      expect.arrayContaining([
        '**/*.map',
        'assets/common-*.js',
        'assets/errors-*.js',
        'assets/noto-*.woff2',
        'splash/**',
      ]),
    );
    expect(PRECACHE.globPatterns.join()).toContain('woff2');
  });
});
