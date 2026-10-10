// Pure navigation state for the stack navigator (08 §3). Browser history is the single source of truth:
// every location change (our push/back, Android back, browser back/forward, deep link) is reduced here into
// per-tab stacks plus a transition describing how to animate. No React, no DOM — fully unit-tested.

export interface TabConfig<TabId extends string = string> {
  readonly id: TabId;
  /** Root pathname of the tab, e.g. "/" or "/updates". */
  readonly path: string;
}

export interface NavConfig<TabId extends string = string> {
  readonly tabs: readonly TabConfig<TabId>[];
  /** Pathnames presented as full-screen modals (Scan, Qibla). */
  readonly modalPaths: readonly string[];
}

/** One screen = one browser history entry. */
export interface Entry {
  /** History entry key (stable across back/forward). */
  readonly key: string;
  readonly href: string;
  readonly pathname: string;
  /** Not a real history entry: the tab root shown under a deep link (back replaces instead of leaving). */
  readonly synthetic?: boolean;
}

export interface NavLocation {
  readonly key: string;
  readonly href: string;
  readonly pathname: string;
}

export type Transition =
  | { readonly type: 'none' }
  | { readonly type: 'push'; readonly tab: string; readonly from: string; readonly to: string }
  | { readonly type: 'pop'; readonly tab: string; readonly from: string; readonly to: string }
  | { readonly type: 'tab'; readonly from: string; readonly to: string }
  | { readonly type: 'replace'; readonly tab: string; readonly to: string }
  | { readonly type: 'modal-present'; readonly key: string }
  | { readonly type: 'modal-dismiss'; readonly key: string };

export interface NavState {
  readonly activeTab: string;
  readonly stacks: Readonly<Record<string, readonly Entry[]>>;
  /** Popped entries still rendered while their exit animation runs, per tab. */
  readonly leaving: Readonly<Record<string, readonly Entry[]>>;
  readonly modal: Entry | null;
  /** A dismissed modal still animating out. */
  readonly leavingModal: Entry | null;
  readonly transition: Transition;
}

let syntheticCounter = 0;

const entryOf = (location: NavLocation): Entry => ({
  key: location.key,
  href: location.href,
  pathname: location.pathname,
});

/** Normalizes "/updates/" → "/updates" (root stays "/"). */
export const normalizePath = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

export function tabForRoot(config: NavConfig, pathname: string): string | undefined {
  const path = normalizePath(pathname);
  return config.tabs.find((tab) => tab.path === path)?.id;
}

const isModal = (config: NavConfig, pathname: string): boolean => config.modalPaths.includes(normalizePath(pathname));

function firstTab(config: NavConfig): string {
  const first = config.tabs[0];
  if (!first) throw new Error('NavConfig needs at least one tab');
  return first.id;
}

function rootEntry(config: NavConfig, tab: string): Entry {
  const path = config.tabs.find((candidate) => candidate.id === tab)?.path ?? '/';
  syntheticCounter += 1;
  return { key: `synthetic-${tab}-${String(syntheticCounter)}`, href: path, pathname: path, synthetic: true };
}

/**
 * Initial state from the first location (cold start / deep link). A deep link opens on top of a synthetic
 * root of the first tab, so the in-app back button still has somewhere to go.
 */
export function initialState(config: NavConfig, location: NavLocation): NavState {
  const home = firstTab(config);
  const empty = { leaving: {}, leavingModal: null, transition: { type: 'none' } } as const;
  if (isModal(config, location.pathname)) {
    return { ...empty, activeTab: home, stacks: { [home]: [rootEntry(config, home)] }, modal: entryOf(location) };
  }
  const rootTab = tabForRoot(config, location.pathname);
  if (rootTab) return { ...empty, activeTab: rootTab, stacks: { [rootTab]: [entryOf(location)] }, modal: null };
  return { ...empty, activeTab: home, stacks: { [home]: [rootEntry(config, home), entryOf(location)] }, modal: null };
}

/** Only the visible top screen animates out; screens it covered are dropped at once (pop to root). */
function withLeaving(state: NavState, tab: string, removedEntries: readonly Entry[]): NavState['leaving'] {
  const top = removedEntries.at(-1);
  const removed = top ? [top] : [];
  if (removed.length === 0) return state.leaving;
  const current = state.leaving[tab] ?? [];
  const keys = new Set(current.map((entry) => entry.key));
  return { ...state.leaving, [tab]: [...current, ...removed.filter((entry) => !keys.has(entry.key))] };
}

/** Removes `key` from every leaving list (it came back, or its exit animation finished). */
function withoutLeaving(leaving: NavState['leaving'], key: string): NavState['leaving'] {
  const next: Record<string, readonly Entry[]> = {};
  for (const [tab, entries] of Object.entries(leaving)) {
    const kept = entries.filter((entry) => entry.key !== key);
    if (kept.length > 0) next[tab] = kept;
  }
  return next;
}

/**
 * Reduces a location change.
 *
 * - Modal path → present (or keep) the modal; leaving a modal path dismisses it.
 * - Key already in the active tab's stack → pop to it (back, re-tap tab, synthetic-root replace).
 * - Key in another tab's stack → switch to that tab (its stack is truncated to the entry).
 * - New tab-root path → switch to that tab and reset its stack to this root.
 * - Otherwise → push onto the active tab.
 *
 * @param replaced - the location replaced the current entry (history.replace) instead of adding one.
 */
export function reduceLocation(config: NavConfig, state: NavState, location: NavLocation, replaced = false): NavState {
  // 1. Modals.
  if (isModal(config, location.pathname)) {
    if (state.modal?.key === location.key) return { ...state, transition: { type: 'none' } };
    return {
      ...state,
      modal: entryOf(location),
      leavingModal: null,
      transition: { type: 'modal-present', key: location.key },
    };
  }
  let base = state;
  let dismissed: Transition | null = null;
  if (state.modal) {
    base = { ...state, modal: null, leavingModal: state.modal };
    dismissed = { type: 'modal-dismiss', key: state.modal.key };
  }

  const activeStack = base.stacks[base.activeTab] ?? [];
  const top = activeStack.at(-1);

  // 2. Same entry (e.g. modal closed back onto it).
  if (top?.key === location.key) return { ...base, transition: dismissed ?? { type: 'none' } };

  // 3. Pop within the active tab.
  const index = activeStack.findIndex((entry) => entry.key === location.key);
  if (index >= 0 && top) {
    const removed = activeStack.slice(index + 1);
    const target = activeStack[index];
    if (!target) return base;
    return {
      ...base,
      stacks: { ...base.stacks, [base.activeTab]: activeStack.slice(0, index + 1) },
      leaving: withLeaving(base, base.activeTab, removed),
      transition: dismissed ?? { type: 'pop', tab: base.activeTab, from: top.key, to: target.key },
    };
  }

  // 4. Entry of another tab (back/forward across tabs, or tab tap restoring that tab's top).
  for (const [tab, stack] of Object.entries(base.stacks)) {
    if (tab === base.activeTab) continue;
    const found = stack.findIndex((entry) => entry.key === location.key);
    if (found < 0) continue;
    return {
      ...base,
      activeTab: tab,
      stacks: { ...base.stacks, [tab]: stack.slice(0, found + 1) },
      transition: dismissed ?? { type: 'tab', from: base.activeTab, to: tab },
    };
  }

  const entry = entryOf(location);
  const leaving = withoutLeaving(base.leaving, entry.key);

  // 5. A tab root not seen before: switch and reset that tab.
  const rootTab = tabForRoot(config, location.pathname);
  if (rootTab) {
    if (rootTab === base.activeTab && top) {
      // Re-entering the active tab's root with a new key → pop to root and adopt the new key.
      const removed = activeStack.slice(1);
      return {
        ...base,
        leaving: withLeaving({ ...base, leaving }, rootTab, removed),
        stacks: { ...base.stacks, [rootTab]: [entry] },
        transition:
          dismissed ??
          (removed.length > 0
            ? { type: 'pop', tab: rootTab, from: top.key, to: entry.key }
            : { type: 'replace', tab: rootTab, to: entry.key }),
      };
    }
    return {
      ...base,
      leaving,
      activeTab: rootTab,
      stacks: { ...base.stacks, [rootTab]: [entry] },
      transition: dismissed ?? { type: 'tab', from: base.activeTab, to: rootTab },
    };
  }

  // 6. Replace the top entry (history.replace) without animation.
  if (replaced && top) {
    return {
      ...base,
      leaving,
      stacks: { ...base.stacks, [base.activeTab]: [...activeStack.slice(0, -1), entry] },
      transition: dismissed ?? { type: 'replace', tab: base.activeTab, to: entry.key },
    };
  }

  // 7. Push.
  return {
    ...base,
    leaving,
    stacks: { ...base.stacks, [base.activeTab]: [...activeStack, entry] },
    transition: dismissed ?? { type: 'push', tab: base.activeTab, from: top?.key ?? '', to: entry.key },
  };
}

/** Exit animation of a popped screen finished: stop rendering it. */
export function finishLeaving(state: NavState, key: string): NavState {
  return { ...state, leaving: withoutLeaving(state.leaving, key) };
}

/** Exit animation of a dismissed modal finished. */
export function finishModalLeaving(state: NavState, key: string): NavState {
  return state.leavingModal?.key === key ? { ...state, leavingModal: null } : state;
}

/** Depth of the active stack (1 = at the tab root). */
export const activeDepth = (state: NavState): number => state.stacks[state.activeTab]?.length ?? 0;
