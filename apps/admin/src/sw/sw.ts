/// <reference lib="webworker" />
// Admin service worker (01 §5.6, PHASE_00 T0.11): precache the shell only. It NEVER caches `/api/*` —
// admin data is always live and authenticated (no route below matches an API request, so the browser's
// network handles it untouched). Updates wait for the user's "Refresh" (SKIP_WAITING message).
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import type { WorkboxPlugin } from 'workbox-core/types';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

const ASSETS_CACHE = 'mc-admin-assets-v1';

/**
 * Workbox's plugin classes declare optional callbacks as `T | undefined`, which `exactOptionalPropertyTypes`
 * rejects for Workbox's own `WorkboxPlugin` type — a mismatch inside Workbox's typings, not at runtime
 * (library boundary; the classes implement the interface).
 */
const plugins = (...items: object[]) => items as WorkboxPlugin[];

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// Hashed locale chunks and script fonts that are not precached (only the admin's own locale is fetched).
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
  new CacheFirst({
    cacheName: ASSETS_CACHE,
    plugins: plugins(new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 60 })),
  }),
);

setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') return (await matchPrecache('/offline.html')) ?? Response.error();
  return Response.error();
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || !('type' in data)) return;
  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
  if (data.type === 'CACHE_URLS' && 'urls' in data && Array.isArray(data.urls)) {
    const urls = data.urls.filter(
      (value): value is string =>
        typeof value === 'string' &&
        new URL(value, self.location.origin).origin === self.location.origin &&
        new URL(value, self.location.origin).pathname.startsWith('/assets/'),
    );
    event.waitUntil(caches.open(ASSETS_CACHE).then((cache) => cache.addAll(urls)));
  }
});
