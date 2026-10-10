/// <reference lib="webworker" />
// Musalli service worker (01 §5.6, PHASE_00 T0.11) — built by vite-plugin-pwa (`injectManifest`).
// Precache: the app shell (JS/CSS/HTML, Inter, icons). Runtime: per-locale chunks and script fonts
// CacheFirst (only the active locale is ever downloaded — 09 §6), media images CacheFirst, versioned API
// GETs CacheFirst (immutable), the versions endpoint NetworkFirst (3 s) → cache; everything else network.
// Updates wait for the user's "Refresh" (SKIP_WAITING message) — never auto-reload mid-task.
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import type { WorkboxPlugin } from 'workbox-core/types';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

const DAY = 24 * 60 * 60;
/** Runtime cache names (versioned so a future layout change can drop them). */
const CACHE = {
  assets: 'mc-assets-v1',
  images: 'mc-images-v1',
  api: 'mc-api-v1',
  versions: 'mc-versions-v1',
} as const;

/**
 * Workbox's plugin classes declare optional callbacks as `T | undefined`, which `exactOptionalPropertyTypes`
 * rejects for Workbox's own `WorkboxPlugin` type — a mismatch inside Workbox's typings, not at runtime
 * (library boundary; the classes implement the interface).
 */
const plugins = (...items: object[]) => items as WorkboxPlugin[];

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

// SPA navigations → the precached shell; `/api/*` never.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

// Hashed build assets that are not precached (locale chunks, script fonts): immutable → cache on first use.
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/assets/'),
  new CacheFirst({
    cacheName: CACHE.assets,
    plugins: plugins(new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 60 })),
  }),
);

// Masjid / campaign photos from the media origin: content-hashed names → CacheFirst (01 §5.2).
// Validated at build time (parseClientEnv in vite.config.ts); absent in local dev without a media origin.
const configuredMedia: unknown = import.meta.env['VITE_PUBLIC_MEDIA_ORIGIN'];
const mediaOrigin = typeof configuredMedia === 'string' && configuredMedia !== '' ? configuredMedia : null;
registerRoute(
  ({ url, request }) => request.destination === 'image' && url.origin === mediaOrigin,
  new CacheFirst({
    cacheName: CACHE.images,
    plugins: plugins(
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true }),
    ),
  }),
);

// Followed masjids' versions: fresh when possible, cached when offline (01 §5.6).
registerRoute(
  ({ url, sameOrigin, request }) =>
    sameOrigin && request.method === 'GET' && url.pathname === '/api/v1/masjids/versions',
  new NetworkFirst({
    cacheName: CACHE.versions,
    networkTimeoutSeconds: 3,
    plugins: plugins(new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ maxEntries: 20 })),
  }),
);

// Versioned API GETs (`?v=`) are immutable for that version → CacheFirst.
registerRoute(
  ({ url, sameOrigin, request }) =>
    sameOrigin && request.method === 'GET' && url.pathname.startsWith('/api/v1/') && url.searchParams.has('v'),
  new CacheFirst({
    cacheName: CACHE.api,
    plugins: plugins(
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true }),
    ),
  }),
);

// A navigation that still fails (shell missing from the cache) gets the multilingual offline page.
setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') return (await matchPrecache('/offline.html')) ?? Response.error();
  return Response.error();
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || !('type' in data)) return;
  // The user tapped "Refresh" on the update toast (01 §5.6).
  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
    return;
  }
  // First visit: the page loaded its locale chunk and fonts before this worker controlled it — cache them now
  // so the app works offline without another reload. Same-origin hashed assets only.
  if (data.type === 'CACHE_URLS' && 'urls' in data && Array.isArray(data.urls)) {
    const urls = data.urls.filter(
      (value): value is string =>
        typeof value === 'string' &&
        new URL(value, self.location.origin).origin === self.location.origin &&
        new URL(value, self.location.origin).pathname.startsWith('/assets/'),
    );
    event.waitUntil(caches.open(CACHE.assets).then((cache) => cache.addAll(urls)));
  }
});
