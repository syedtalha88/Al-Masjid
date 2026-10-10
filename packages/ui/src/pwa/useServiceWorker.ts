import { useCallback, useEffect, useRef, useState } from 'react';

/** How often a visible app checks for a new deployment, ms (plus on every return to the foreground). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** Fewest ms between two update checks (focus can fire often). */
const UPDATE_CHECK_MIN_GAP_MS = 60 * 1000;

export interface ServiceWorkerState {
  /** A new version is installed and waiting (show "Update available"). */
  readonly updateAvailable: boolean;
  /** Activates the waiting version and reloads once it controls the page (user-initiated only — 01 §5.6). */
  readonly applyUpdate: () => void;
}

/** Same-origin hashed assets this page already loaded (locale chunk, fonts) — cached by the SW on first visit. */
function loadedAssetUrls(): string[] {
  return performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => {
      const url = new URL(name);
      return url.origin === location.origin && url.pathname.startsWith('/assets/');
    });
}

/**
 * Registers the app's service worker (production builds only) and exposes the update flow of 01 §5.6:
 * a new worker that finished installing while an old one controls the page → `updateAvailable`; the user
 * taps Refresh → `applyUpdate` sends `SKIP_WAITING`, and the page reloads when the new worker takes control.
 * Checks for updates hourly and whenever the app returns to the foreground.
 *
 * @param options.enabled - default: production builds with service-worker support.
 * @param options.url - the worker script (default `/sw.js`).
 * @param options.reload - reloads into the new version (default `location.reload`; injectable for tests).
 */
export function useServiceWorker({
  enabled = import.meta.env.PROD,
  url = '/sw.js',
  reload = () => {
    window.location.reload();
  },
}: { readonly enabled?: boolean; readonly url?: string; readonly reload?: () => void } = {}): ServiceWorkerState {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloading = useRef(false);
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  useEffect(() => {
    if (!enabled || !('serviceWorker' in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = Date.now();
    let cancelled = false;

    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        // "installed" while another worker controls the page = an update (not the first install).
        if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
      };
      check();
      worker.addEventListener('statechange', check);
    };

    const checkForUpdate = () => {
      if (!registration || Date.now() - lastCheck < UPDATE_CHECK_MIN_GAP_MS) return;
      lastCheck = Date.now();
      void registration.update().catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register(url, { scope: '/' });
      } catch {
        return; // No SW (private mode, blocked): the app still works online.
      }
      if (cancelled) return;
      if (registration.waiting) watch(registration.waiting);
      registration.addEventListener('updatefound', () => {
        watch(registration?.installing ?? null);
      });
      const ready = await navigator.serviceWorker.ready;
      ready.active?.postMessage({ type: 'CACHE_URLS', urls: loadedAssetUrls() });
    };

    // After load, so registration never competes with the first render.
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', () => void register(), { once: true });
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(checkForUpdate, UPDATE_CHECK_MS);
    const onControllerChange = () => {
      if (!reloading.current) return;
      reloadRef.current();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [enabled, url]);

  const applyUpdate = useCallback(() => {
    if (!waiting) return;
    reloading.current = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  return { updateAvailable: waiting !== null, applyUpdate };
}
