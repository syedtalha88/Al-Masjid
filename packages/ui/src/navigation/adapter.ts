import type { AnyRoute, AnyRouter } from '@tanstack/react-router';
import type { ComponentType } from 'react';

import type { NavLocation } from './model.ts';

/** A location as the navigator sees it (search parsed to plain strings). */
export interface AdapterLocation extends NavLocation {
  readonly search: Readonly<Record<string, string>>;
}

export interface ResolvedScreen {
  readonly routeId: string;
  readonly component: ComponentType;
  /** Path params, still strings — screens validate them (CLAUDE.md §6). */
  readonly params: Readonly<Record<string, string>>;
}

/** History entry state the navigator writes: `mcKey` re-targets an existing screen (tab tap, pop to root). */
export interface NavHistoryState {
  readonly mcKey?: string;
}

/**
 * What the navigator needs from the router: the current location, a change feed, history operations and
 * route resolution. Browser history stays the single source of truth (Android back, browser back/forward).
 */
export interface NavAdapter {
  getLocation(): AdapterLocation;
  /** `replaced` = the change replaced the current entry. */
  subscribe(listener: (location: AdapterLocation, replaced: boolean) => void): () => void;
  push(href: string, state?: NavHistoryState): void;
  replace(href: string, state?: NavHistoryState): void;
  back(): void;
  resolve(pathname: string): ResolvedScreen | null;
  /** Starts loading a route's code-split chunk (on press, before the push). */
  preload(pathname: string): void;
}

interface HistoryStateShape {
  readonly mcKey?: unknown;
  readonly __TSR_key?: unknown;
  readonly key?: unknown;
  readonly __TSR_index?: unknown;
}

/** Stable key of a history entry: ours (`mcKey`) first, then TanStack's per-entry key. */
export function locationKey(state: HistoryStateShape): string {
  for (const candidate of [state.mcKey, state.__TSR_key, state.key]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return `index-${String(typeof state.__TSR_index === 'number' ? state.__TSR_index : 0)}`;
}

/** The parts of TanStack's history the adapter uses (`AnyRouter` types it loosely). */
interface HistoryLocationLike {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly state: unknown;
}
interface HistoryLike {
  readonly location: HistoryLocationLike;
  subscribe(listener: (args: { location: HistoryLocationLike; action: { type: string } }) => void): () => void;
  push(path: string, state?: NavHistoryState): void;
  replace(path: string, state?: NavHistoryState): void;
  back(): void;
}

/**
 * Adapter over a TanStack Router instance. Screens are the route components themselves (code-split chunks
 * resolve through `React.lazy`-style suspension); the navigator renders them from its own stack, never
 * through `<Outlet>`, so covered screens keep their content (DECISIONS #44).
 */
export function tanstackAdapter(router: AnyRouter): NavAdapter {
  const history = router.history as HistoryLike;
  const toLocation = (location: HistoryLocationLike): AdapterLocation => ({
    key: locationKey(location.state as HistoryStateShape),
    href: location.href,
    pathname: location.pathname,
    search: Object.fromEntries(new URLSearchParams(location.search)),
  });
  const findRoute = (pathname: string) =>
    (router.getMatchedRoutes(pathname) as [unknown, unknown, AnyRoute | undefined])[2];
  return {
    getLocation: () => toLocation(history.location),
    subscribe: (listener) =>
      history.subscribe(({ location, action }) => {
        listener(toLocation(location), action.type === 'REPLACE');
      }),
    push: (href, state) => {
      history.push(href, state);
    },
    replace: (href, state) => {
      history.replace(href, state);
    },
    back: () => {
      history.back();
    },
    resolve(pathname) {
      // `AnyRouter` returns `any` here; the shape is TanStack's documented GetMatchRoutesFn tuple.
      const [, rawParams, route] = router.getMatchedRoutes(pathname) as [
        unknown,
        Record<string, string>,
        AnyRoute | undefined,
      ];
      const component = (route?.options as { component?: ComponentType } | undefined)?.component;
      if (!route || !component) return null;
      return { routeId: route.id as string, component, params: rawParams };
    },
    preload(pathname) {
      const route = findRoute(pathname);
      if (route) void router.loadRouteChunk(route);
    },
  };
}
