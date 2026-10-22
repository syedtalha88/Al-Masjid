// The app's data context (T2.3): device store (IndexedDB), API client, persisted TanStack Query cache, versions
// poller, registration retry queue and follow reconciliation. Screens use the hooks; nothing here renders UI.
import type { MasjidVersions } from '@mc/shared/contracts/public';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createContext, type ReactNode, use, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { type ApiClient, createApiClient } from './api/client.ts';
import { pruneStaleVersions, versionsQuery } from './api/queries.ts';
import { recordServerTime } from './clock.ts';
import { DEVICE_DB, idbBackend, QUERY_CACHE_DB } from './device/idb.ts';
import { createDeviceStore, type DeviceState, type DeviceStore, visibleFollows } from './device/store.ts';
import type { SyncDeps } from './device/sync.ts';
import { platformKind } from './platform.ts';
import {
  appRelease,
  CACHE_MAX_AGE_MS,
  createPersister,
  createQueryClient,
  shouldPersistQuery,
} from './query/persist.ts';

export interface AppData {
  readonly store: DeviceStore;
  readonly api: ApiClient;
  readonly queryClient: QueryClient;
  readonly sync: SyncDeps;
}

const DataContext = createContext<AppData | null>(null);

/** Registration / follow sync is never needed for the first paint: its code loads right after start. */
const loadSync = () => import('./device/sync.ts');

/** The API base path of this origin (`VITE_PUBLIC_API_BASE`, default `/api/v1`). */
const apiBase = (): string => {
  const configured: unknown = import.meta.env['VITE_PUBLIC_API_BASE'];
  return typeof configured === 'string' && configured !== '' ? configured.replace(/\/$/, '') : '/api/v1';
};

export interface CreateAppDataOptions {
  readonly locale: DeviceState['locale'];
  /** Turnstile token source (the widget arrives with onboarding, T2.4). */
  readonly turnstileToken: () => Promise<string>;
  readonly store?: DeviceStore;
  readonly fetch?: typeof fetch;
}

/** Builds the data layer once per app start. */
export function createAppData(options: CreateAppDataOptions): AppData {
  const store = options.store ?? createDeviceStore(idbBackend(DEVICE_DB), options.locale);
  // The client needs the sync deps (re-register on 401) and the sync deps need the client.
  const holder: { sync?: SyncDeps } = {};
  const api = createApiClient({
    base: apiBase(),
    credentials: () => store.current().credentials,
    onServerTime: recordServerTime,
    onAuthLost: () => {
      const sync = holder.sync;
      if (sync)
        void loadSync()
          .then((module) => module.handleAuthLost(sync))
          .catch(() => undefined);
    },
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const sync: SyncDeps = { store, api, turnstileToken: options.turnstileToken, platform: platformKind() };
  holder.sync = sync;
  return { store, api, queryClient: createQueryClient(), sync };
}

/**
 * Provides the data layer: loads the device document first (the app renders `fallback` until it is read), restores the
 * persisted query cache, and retries a pending registration on start and whenever the browser comes back online.
 */
export function DataProvider({
  data,
  children,
  fallback = null,
}: {
  readonly data: AppData;
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  const persister = useMemo(() => createPersister(idbBackend(QUERY_CACHE_DB)), []);
  useEffect(() => {
    let active = true;
    void data.store.load().then(() => {
      if (active) setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [data.store]);

  useEffect(() => {
    if (!loaded) return;
    const retry = () => {
      const state = data.store.current();
      if (!state.onboardedAt) return;
      void loadSync()
        .then(async (module) => {
          if (state.credentials) await module.reconcileFollows(data.sync);
          else await module.ensureRegistered(data.sync);
        })
        .catch(() => undefined);
    };
    retry();
    window.addEventListener('online', retry);
    return () => {
      window.removeEventListener('online', retry);
    };
  }, [loaded, data]);

  if (!loaded) return <>{fallback}</>;
  return (
    <DataContext value={data}>
      <PersistQueryClientProvider
        client={data.queryClient}
        persistOptions={{
          persister,
          maxAge: CACHE_MAX_AGE_MS,
          buster: appRelease(),
          dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
        }}
      >
        {children}
      </PersistQueryClientProvider>
    </DataContext>
  );
}

/** The data layer (inside `<DataProvider>`). */
export function useAppData(): AppData {
  const data = use(DataContext);
  if (!data) throw new Error('useAppData() must be used inside <DataProvider>');
  return data;
}

/** The device document, re-rendering on every change. */
export function useDeviceState(): DeviceState {
  const { store } = useAppData();
  return useSyncExternalStore(store.subscribe, store.current, store.current);
}

/** Followed masjid ids in the user's order (pending unfollows hidden). */
export function useFollowedIds(): readonly string[] {
  const { follows } = useDeviceState();
  return useMemo(() => visibleFollows(follows).map((follow) => follow.masjidId), [follows]);
}

/**
 * The content versions of the followed masjids — polled on focus and every 60 s while visible; prunes cached queries
 * of older versions whenever new versions arrive.
 */
export function useMasjidVersions(): { readonly versions: MasjidVersions | undefined; readonly refresh: () => void } {
  const { api, queryClient } = useAppData();
  const ids = useFollowedIds();
  const query = useQuery({ ...versionsQuery(api, ids), placeholderData: (previous) => previous });
  useEffect(() => {
    if (query.data) pruneStaleVersions(queryClient, query.data);
  }, [query.data, queryClient]);
  return {
    versions: query.data,
    refresh: () => {
      void query.refetch();
    },
  };
}
