import {
  Component,
  type ComponentType,
  memo,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { trackMotion } from '../motion/lite.ts';
import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { navigation } from '../motion/tokens.ts';
import { reportError } from '../observability/errors.ts';
import type { AdapterLocation, NavAdapter, ResolvedScreen } from './adapter.ts';
import { type NavigatorApi, NavigatorContext, ScreenContext, type ScreenInfo } from './context.ts';
import { animateChannel, getChannel, holdLayer, initLayer, setChannel, translateX } from './driver.ts';
import { type Sample, swipeRelease } from './gesture.ts';
import {
  type Entry,
  finishLeaving,
  finishModalLeaving,
  initialState,
  type NavConfig,
  type NavState,
  reduceLocation,
} from './model.ts';
import { isIOSSafariBrowser } from './platform.ts';

/** DOM nodes of one mounted screen: the sliding section and its dim overlay. */
interface Registered {
  readonly element: HTMLElement;
  readonly dim: HTMLElement;
}

export interface StackNavigatorProps {
  readonly adapter: NavAdapter;
  readonly config: NavConfig;
  /** Tab bar under the screens (omit for single-stack apps such as admin). */
  readonly tabBar?: ComponentType<{ readonly api: NavigatorApi }>;
  /** Shown while a screen's code chunk loads. */
  readonly pendingFallback: ReactNode;
  /** Friendly error with retry (never raw error text). */
  readonly errorFallback: (props: { readonly reset: () => void }) => ReactNode;
  /** Screen for unknown paths. */
  readonly notFound: ComponentType;
}

const direction = (): 1 | -1 => (document.documentElement.dir === 'rtl' ? -1 : 1);
const coveredX = () => -navigation.coveredOffsetPct * direction();
const offscreenX = () => 100 * direction();
const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

function focusTitle(element: HTMLElement | undefined | null) {
  if (!element) return;
  const title = element.querySelector<HTMLElement>('[data-screen-title]');
  (title ?? element).focus({ preventScroll: true });
}

const scrollerOf = (element: HTMLElement | undefined | null) =>
  element?.querySelector<HTMLElement>('[data-screen-scroll]') ?? undefined;

/**
 * iOS-style stack navigator on top of browser history (08 §3): per-tab stacks, push/pop with parallax and
 * dim, interactive edge swipe-back, tab switching that keeps stacks and scroll, full-screen modals with a
 * scaled background, focus management and `inert` on covered screens. Reduced motion → crossfades; lite
 * motion → no modal background scale. Animations are interruptible Motion springs on MotionValues; a swipe
 * release hands its velocity to the spring (DECISIONS #44).
 */
export function StackNavigator({
  adapter,
  config,
  tabBar: TabBarComponent,
  pendingFallback,
  errorFallback,
  notFound,
}: StackNavigatorProps) {
  const { reduced, lite } = useMotionPrefs();
  const [state, setState] = useState<NavState>(() => initialState(config, adapter.getLocation()));
  // Long-lived mutable registries (stable identity; read during render, so not refs).
  const [locations] = useState(
    () => new Map<string, AdapterLocation>([[adapter.getLocation().key, adapter.getLocation()]]),
  );
  const [screens] = useState(() => new Map<string, Registered>());
  const [scrollCache] = useState(() => new Map<string, number>());
  const [resolvedCache] = useState(() => new Map<string, ResolvedScreen | null>());
  const returnFocus = useRef(new Map<string, HTMLElement>());
  const appLayer = useRef<HTMLDivElement>(null);
  const modalDim = useRef<HTMLDivElement>(null);
  const modalLayer = useRef<HTMLDivElement>(null);
  const tabLayers = useRef(new Map<string, HTMLElement>());
  /** Set while our own back button / tab re-tap caused the next pop (iOS Safari heuristic, 08 §3.2). */
  const inAppBack = useRef(false);
  const gestureCommitted = useRef<string | null>(null);
  const scrollTopAfterPop = useRef(false);
  const generation = useRef(0);

  // A navigation is applied as a transition: React renders the affected screens in 5 ms slices instead of one
  // blocking task inside the tap / popstate (50–100 ms at 4× CPU on real screens — F46, DECISIONS #103). Motion does
  // not wait for it: a swipe-back already springs from the finger, and pushes start in the commit's layout effect.
  // The reducer is functional, so back-to-back navigations still compose.
  useEffect(
    () =>
      adapter.subscribe((location, replaced) => {
        locations.set(location.key, location);
        startTransition(() => {
          setState((current) => reduceLocation(config, current, location, replaced));
        });
      }),
    [adapter, config, locations],
  );

  // Preload the code of every tab root and modal while idle, so first taps render without loading.
  useEffect(() => {
    const preloadAll = () => {
      for (const path of [...config.tabs.map((tab) => tab.path), ...config.modalPaths]) adapter.preload(path);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preloadAll);
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(preloadAll, navigation.idlePreloadDelayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [adapter, config]);

  const activeStack = useMemo(() => state.stacks[state.activeTab] ?? [], [state]);

  const api = useMemo<NavigatorApi>(() => {
    const pathOf = (href: string) => new URL(href, window.location.origin).pathname;
    return {
      activeTab: state.activeTab,
      push: (href) => {
        adapter.preload(pathOf(href));
        const top = activeStack.at(-1);
        if (top && document.activeElement instanceof HTMLElement) {
          returnFocus.current.set(top.key, document.activeElement);
        }
        if (state.modal) adapter.replace(href);
        else adapter.push(href);
      },
      replace: (href) => {
        adapter.preload(pathOf(href));
        adapter.replace(href);
      },
      back: () => {
        inAppBack.current = true;
        const below = activeStack.at(-2);
        const top = activeStack.at(-1);
        // A modal opened as the first page (deep link, onboarding → Scan) has no history entry below it: closing must
        // not leave the app, so it replaces itself with the tab root under it.
        if (state.modal) {
          if (top?.synthetic) adapter.replace(top.href, { mcKey: top.key });
          else adapter.back();
        } else if (below?.synthetic) adapter.replace(below.href, { mcKey: below.key });
        else if (below) adapter.back();
      },
      presentModal: (href) => {
        if (document.activeElement instanceof HTMLElement) returnFocus.current.set('modal', document.activeElement);
        adapter.push(href);
      },
      preload: (href) => {
        adapter.preload(pathOf(href));
      },
      selectTab: (tab) => {
        const stack = state.stacks[tab];
        if (tab === state.activeTab) {
          const root = stack?.[0];
          if (stack && root && stack.length > 1) {
            scrollTopAfterPop.current = true;
            inAppBack.current = true;
            adapter.push(root.href, { mcKey: root.key });
          } else {
            const scroller = scrollerOf(root ? screens.get(root.key)?.element : undefined);
            scroller?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
          }
          return;
        }
        const top = stack?.at(-1);
        if (top) adapter.push(top.href, { mcKey: top.key });
        else adapter.push(config.tabs.find((candidate) => candidate.id === tab)?.path ?? '/');
      },
    };
  }, [adapter, config, state, activeStack, reduced, screens]);

  // Screens get a navigator api that never changes identity (it calls the latest one): with the changing `api` in
  // context, every mounted screen that calls `useNavigator()` re-rendered on each push, pop and tab switch — inside
  // the tap (perf trace T2.14). `activeTab` reads the current value; the tab bar, which shows it, gets `api` itself.
  const latestApi = useRef(api);
  useLayoutEffect(() => {
    latestApi.current = api;
  }, [api]);
  const stableApi = useMemo<NavigatorApi>(
    () => ({
      get activeTab() {
        return latestApi.current.activeTab;
      },
      push: (href) => {
        latestApi.current.push(href);
      },
      replace: (href) => {
        latestApi.current.replace(href);
      },
      back: () => {
        latestApi.current.back();
      },
      selectTab: (tab) => {
        latestApi.current.selectTab(tab);
      },
      presentModal: (href) => {
        latestApi.current.presentModal(href);
      },
      preload: (href) => {
        latestApi.current.preload(href);
      },
    }),
    [],
  );

  // The modal backdrop starts transparent (the driver's default opacity is 1).
  useLayoutEffect(() => {
    initLayer(modalDim.current, { opacity: 0 });
  }, []);

  // ---- Transitions -------------------------------------------------------------------------------------
  // Motion springs on MotionValues (driver.ts): interrupting a transition continues from the current position
  // and velocity; a swipe release hands the finger's velocity to the spring.
  useLayoutEffect(() => {
    const transition = state.transition;
    if (transition.type === 'none' || transition.type === 'replace') return;
    const run = (generation.current += 1);
    const current = () => run === generation.current;
    const nodes = (key: string) => screens.get(key);
    const stopTracking = trackMotion();

    switch (transition.type) {
      case 'push': {
        const incoming = nodes(transition.to);
        const outgoing = nodes(transition.from);
        let moves: Promise<boolean>[];
        if (reduced) {
          setChannel(outgoing?.element, 'x', coveredX());
          setChannel(outgoing?.dim, 'opacity', navigation.coveredDim);
          moves = [animateChannel(incoming?.element, 'opacity', 1, 'fade')];
        } else {
          moves = [
            animateChannel(incoming?.element, 'x', 0, 'smooth'),
            animateChannel(outgoing?.element, 'x', coveredX(), 'smooth'),
            animateChannel(outgoing?.dim, 'opacity', navigation.coveredDim, 'smooth'),
          ];
        }
        void Promise.all(moves).then(() => {
          stopTracking();
          if (current()) focusTitle(incoming?.element);
        });
        break;
      }
      case 'pop': {
        const leaving = nodes(transition.from);
        const target = nodes(transition.to);
        // A committed swipe is already springing to these targets with the finger's velocity: join it.
        const fromGesture = gestureCommitted.current === transition.from;
        gestureCommitted.current = null;
        const native = isIOSSafariBrowser() && !inAppBack.current && !fromGesture;
        inAppBack.current = false;
        let moves: Promise<boolean>[] = [];
        if (native) {
          setChannel(target?.element, 'x', 0);
          setChannel(target?.dim, 'opacity', 0);
        } else if (reduced && !fromGesture) {
          setChannel(target?.element, 'x', 0);
          setChannel(target?.dim, 'opacity', 0);
          moves = [animateChannel(leaving?.element, 'opacity', 0, 'fade')];
        } else {
          moves = [
            animateChannel(leaving?.element, 'x', offscreenX(), 'smooth'),
            animateChannel(target?.element, 'x', 0, 'smooth'),
            animateChannel(target?.dim, 'opacity', 0, 'smooth'),
          ];
        }
        void Promise.all(moves).then(() => {
          stopTracking();
          setState((latest) => finishLeaving(latest, transition.from));
          if (!current()) return;
          const restore = returnFocus.current.get(transition.to);
          returnFocus.current.delete(transition.to);
          if (restore?.isConnected && restore !== target?.element && target?.element.contains(restore)) {
            restore.focus({ preventScroll: true });
          } else focusTitle(target?.element);
          if (scrollTopAfterPop.current) {
            scrollTopAfterPop.current = false;
            scrollerOf(target?.element)?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
          }
        });
        break;
      }
      case 'tab': {
        const layer = tabLayers.current.get(transition.to);
        if (layer && !reduced) {
          setChannel(layer, 'opacity', 0);
          void animateChannel(layer, 'opacity', 1, 'quick').then(stopTracking);
        } else {
          stopTracking();
        }
        break;
      }
      case 'modal-present': {
        const modal = modalLayer.current;
        const background = !reduced && !lite;
        const moves = [
          reduced ? animateChannel(modal, 'opacity', 1, 'fade') : animateChannel(modal, 'y', 0, 'smooth'),
          ...(background
            ? [
                animateChannel(appLayer.current, 'scale', navigation.modalBackgroundScale, 'smooth'),
                animateChannel(appLayer.current, 'radius', navigation.modalBackgroundRadiusPx, 'smooth'),
                animateChannel(modalDim.current, 'opacity', navigation.modalDim, 'smooth'),
              ]
            : []),
        ];
        void Promise.all(moves).then(() => {
          stopTracking();
          if (current()) focusTitle(modal);
        });
        break;
      }
      case 'modal-dismiss': {
        const modal = modalLayer.current;
        inAppBack.current = false;
        let moves: Promise<boolean>[];
        if (reduced) {
          setChannel(appLayer.current, 'scale', 1);
          setChannel(appLayer.current, 'radius', 0);
          setChannel(modalDim.current, 'opacity', 0);
          moves = [animateChannel(modal, 'opacity', 0, 'fade')];
        } else {
          moves = [
            animateChannel(modal, 'y', 100, 'smooth'),
            animateChannel(appLayer.current, 'scale', 1, 'smooth'),
            animateChannel(appLayer.current, 'radius', 0, 'smooth'),
            animateChannel(modalDim.current, 'opacity', 0, 'smooth'),
          ];
        }
        void Promise.all(moves).then(() => {
          stopTracking();
          setState((latest) => finishModalLeaving(latest, transition.key));
          if (!current()) return;
          const restore = returnFocus.current.get('modal');
          returnFocus.current.delete('modal');
          if (restore?.isConnected) restore.focus({ preventScroll: true });
        });
        break;
      }
    }
    // Runs once per transition object (each reduceLocation result is a new object).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the transition only
  }, [state.transition]);

  // ---- Swipe-back gesture (08 §3.2) ------------------------------------------------------------------------
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    /** Pointer x when the drag activated, and the top screen's progress then (grabbed mid-animation). */
    originX: number;
    originProgress: number;
    samples: Sample[];
    top: string;
    below: string;
    release: () => void;
  } | null>(null);

  const canSwipeBack = !state.modal && activeStack.length > 1;

  const onEdgePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const top = activeStack.at(-1);
      const below = activeStack.at(-2);
      if (!canSwipeBack || !top || !below || event.button !== 0) return;
      // Capture now: the finger leaves the 24px strip before the drag activates.
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        originX: event.clientX,
        originProgress: 0,
        samples: [[event.clientX * direction(), event.timeStamp]],
        top: top.key,
        below: below.key,
        release: () => undefined,
      };
    },
    [activeStack, canSwipeBack],
  );

  const onEdgePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = drag.current;
      if (current?.pointerId !== event.pointerId) return;
      const sign = direction();
      const top = screens.get(current.top);
      const below = screens.get(current.below);
      if (!current.active) {
        const dx = (event.clientX - current.startX) * sign;
        const dy = event.clientY - current.startY;
        if (Math.abs(dy) > navigation.swipeActivatePx && Math.abs(dy) > Math.abs(dx)) {
          drag.current = null;
          return;
        }
        if (dx < navigation.swipeActivatePx) return;
        current.active = true;
        // Grab the screen where it is (it may still be springing): no jump to the finger.
        current.originX = event.clientX;
        current.originProgress = clamp01((getChannel(top?.element, 'x') * sign) / 100);
        const stopTracking = trackMotion();
        const holds = [holdLayer(top?.element), holdLayer(below?.element), holdLayer(below?.dim)];
        current.release = () => {
          for (const release of holds) release();
          stopTracking();
        };
      }
      // The finger moves the screen 1:1; the covered screen's parallax and dim follow its progress.
      const progress = clamp01(current.originProgress + ((event.clientX - current.originX) * sign) / window.innerWidth);
      setChannel(top?.element, 'x', progress * 100 * sign);
      setChannel(below?.element, 'x', coveredX() * (1 - progress));
      setChannel(below?.dim, 'opacity', navigation.coveredDim * (1 - progress));
      current.samples.push([event.clientX * sign, event.timeStamp]);
      if (current.samples.length > 8) current.samples.shift();
    },
    [screens],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const current = drag.current;
      drag.current = null;
      if (current?.pointerId !== event.pointerId || !current.active) return;
      const sign = direction();
      const top = screens.get(current.top);
      const below = screens.get(current.below);
      const progress = clamp01((getChannel(top?.element, 'x') * sign) / 100);
      const { commit, progressVelocity } = swipeRelease(
        current.samples,
        [event.clientX * sign, event.timeStamp],
        progress,
        window.innerWidth,
        cancelled,
      );
      // Release velocity (widths/s) converted into each value's own units per second.
      const end = commit ? 1 : 0;
      void Promise.all([
        animateChannel(top?.element, 'x', end * 100 * sign, 'smooth', progressVelocity * 100 * sign),
        animateChannel(below?.element, 'x', coveredX() * (1 - end), 'smooth', -coveredX() * progressVelocity),
        animateChannel(
          below?.dim,
          'opacity',
          navigation.coveredDim * (1 - end),
          'smooth',
          -navigation.coveredDim * progressVelocity,
        ),
      ]).then(current.release);
      if (commit) {
        // Pop right away; the pop transition joins these springs instead of restarting them.
        gestureCommitted.current = current.top;
        api.back();
      }
    },
    [api, screens],
  );

  // ---- Render ----------------------------------------------------------------------------------------------
  const modalOpen = state.modal !== null;
  const pushedKey = state.transition.type === 'push' ? state.transition.to : null;

  // Route resolution is cached per pathname so a navigation re-renders only the screens that changed.
  const resolve = (pathname: string) => {
    if (!resolvedCache.has(pathname)) resolvedCache.set(pathname, adapter.resolve(pathname));
    return resolvedCache.get(pathname) ?? null;
  };

  const renderScreen = (
    entry: Entry,
    tab: string,
    depth: number,
    isTop: boolean,
    leaving: boolean,
    isModal: boolean,
  ) => {
    const resolved = resolve(entry.pathname);
    const entering = !isModal && pushedKey === entry.key;
    const initial = entering
      ? reduced
        ? { x: 0, dim: 0, opacity: 0 }
        : { x: offscreenX(), dim: 0, opacity: 1 }
      : isTop || leaving || isModal
        ? { x: 0, dim: 0, opacity: 1 }
        : { x: coveredX(), dim: navigation.coveredDim, opacity: 1 };
    return (
      <ScreenSlot
        key={entry.key}
        entry={entry}
        tab={tab}
        depth={depth}
        isTop={isTop && !leaving && (isModal || !modalOpen)}
        isModal={isModal}
        content={resolved?.component ?? notFound}
        params={resolved?.params ?? EMPTY}
        search={locations.get(entry.key)?.search ?? EMPTY}
        initialX={initial.x}
        initialDim={initial.dim}
        initialOpacity={initial.opacity}
        deferContent={entering}
        registry={screens}
        scrollCache={scrollCache}
        pendingFallback={pendingFallback}
        errorFallback={errorFallback}
      />
    );
  };

  const modalEntry = state.modal ?? state.leavingModal;

  return (
    <NavigatorContext value={stableApi}>
      <div className="fixed inset-0 overflow-hidden bg-text">
        <div
          ref={appLayer}
          className={`absolute inset-0 overflow-hidden bg-bg ${
            TabBarComponent ? '[--mc-tabbar-h:calc(4rem+env(safe-area-inset-bottom))]' : ''
          }`}
          inert={modalOpen}
          aria-hidden={modalOpen || undefined}
        >
          {Object.entries(state.stacks).map(([tab, stack]) => {
            const active = tab === state.activeTab;
            const mounted = stack.slice(-navigation.maxMounted);
            const leaving = state.leaving[tab] ?? [];
            return (
              <div
                key={tab}
                ref={(element) => {
                  if (element) tabLayers.current.set(tab, element);
                  else tabLayers.current.delete(tab);
                }}
                data-tab={tab}
                // `visibility`, not `content-visibility: hidden` (tried in T2.14 for cheaper tab switches): WebKit then
                // lost the hidden tab's scroll position.
                className={`absolute inset-0 ${active ? '' : 'invisible'}`}
                inert={!active}
                aria-hidden={!active || undefined}
              >
                {mounted.map((entry) => {
                  const depth = stack.indexOf(entry) + 1;
                  return renderScreen(entry, tab, depth, active && depth === stack.length, false, false);
                })}
                {leaving.map((entry) => renderScreen(entry, tab, stack.length + 1, false, true, false))}
              </div>
            );
          })}
          {canSwipeBack ? (
            <div
              aria-hidden
              data-swipe-edge
              className="absolute inset-y-0 start-0 z-10 w-6 touch-pan-y"
              onPointerDown={onEdgePointerDown}
              onPointerMove={onEdgePointerMove}
              onPointerUp={(event) => {
                endDrag(event, false);
              }}
              onPointerCancel={(event) => {
                endDrag(event, true);
              }}
            />
          ) : null}
          {TabBarComponent ? <TabBarComponent api={api} /> : null}
        </div>
        <div ref={modalDim} className="pointer-events-none absolute inset-0 bg-text opacity-0" />
        {modalEntry ? (
          <ModalHost
            key={modalEntry.key}
            layerRef={modalLayer}
            startHidden={state.transition.type === 'modal-present'}
            reduced={reduced}
            open={state.modal !== null}
          >
            {renderScreen(modalEntry, 'modal', 1, true, !state.modal, true)}
          </ModalHost>
        ) : null}
      </div>
    </NavigatorContext>
  );
}

const EMPTY: Readonly<Record<string, string>> = Object.freeze({});

interface ScreenSlotProps {
  readonly entry: Entry;
  readonly tab: string;
  readonly depth: number;
  readonly isTop: boolean;
  readonly isModal: boolean;
  readonly content: ComponentType;
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
  readonly initialX: number;
  readonly initialDim: number;
  readonly initialOpacity: number;
  readonly registry: Map<string, Registered>;
  readonly scrollCache: Map<string, number>;
  readonly pendingFallback: ReactNode;
  readonly errorFallback: (props: { readonly reset: () => void }) => ReactNode;
  /** Mounted by a push: the layer starts moving at once, the content renders as a transition (below). */
  readonly deferContent: boolean;
}

/**
 * A screen and its context; memoized so navigation re-renders only screens whose state changed (08 §8).
 *
 * A pushed screen's content renders in a React transition: rendering a full screen synchronously inside the tap took
 * ~90 ms at 4× CPU (Masjid Detail, perf trace T2.14) — a long task that delays the slide's first frame. As a
 * transition it is rendered in 5 ms slices while the layer already slides in (plain background first, content within
 * the first frames).
 */
const ScreenSlot = memo(function ScreenSlot({
  entry,
  tab,
  depth,
  isTop,
  isModal,
  content: Content,
  params,
  search,
  initialX,
  initialDim,
  initialOpacity,
  registry,
  scrollCache,
  pendingFallback,
  errorFallback,
  deferContent,
}: ScreenSlotProps) {
  const info = useMemo<ScreenInfo>(
    () => ({ entry, tab, depth, isTop, params, search, isModal }),
    [entry, tab, depth, isTop, params, search, isModal],
  );
  const [showContent, setShowContent] = useState(!deferContent);
  useEffect(() => {
    if (showContent) return;
    startTransition(() => {
      setShowContent(true);
    });
  }, [showContent]);
  return (
    <ScreenHost
      entryKey={entry.key}
      initial={{ x: initialX, dim: initialDim, opacity: initialOpacity }}
      interactive={isTop}
      registry={registry}
      scrollCache={scrollCache}
    >
      <ScreenContext value={info}>
        <ScreenBoundary fallback={errorFallback}>
          <Suspense fallback={pendingFallback}>{showContent ? <Content /> : pendingFallback}</Suspense>
        </ScreenBoundary>
      </ScreenContext>
    </ScreenHost>
  );
});

interface ScreenHostProps {
  readonly entryKey: string;
  readonly initial: { readonly x: number; readonly dim: number; readonly opacity: number };
  readonly interactive: boolean;
  readonly registry: Map<string, Registered>;
  readonly scrollCache: Map<string, number>;
  readonly children: ReactNode;
}

/** One mounted screen. Its starting style is captured at mount; afterwards only the navigator moves it. */
function ScreenHost({ entryKey, initial, interactive, registry, scrollCache, children }: ScreenHostProps) {
  const [start] = useState(initial);
  const [initialStyle] = useState(() => ({ transform: translateX(start.x), opacity: start.opacity }));
  const [initialDim] = useState(() => ({ opacity: start.dim }));
  const element = useRef<HTMLElement>(null);
  const dim = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = element.current;
    const overlay = dim.current;
    if (!node || !overlay) return;
    // Hand the rendered starting style to the animation driver (runs before the navigator's transition).
    initLayer(node, { x: start.x, opacity: start.opacity });
    initLayer(overlay, { opacity: start.dim });
    registry.set(entryKey, { element: node, dim: overlay });
    const scroller = scrollerOf(node);
    const cached = scrollCache.get(entryKey);
    if (scroller && cached !== undefined) scroller.scrollTop = cached;
    return () => {
      if (scroller) scrollCache.set(entryKey, scroller.scrollTop);
      registry.delete(entryKey);
    };
  }, [entryKey, registry, scrollCache, start]);

  return (
    <section
      ref={element}
      data-screen={entryKey}
      tabIndex={-1}
      className="absolute inset-0 overflow-hidden bg-bg outline-none [contain:layout_paint]"
      style={initialStyle}
      inert={!interactive}
      aria-hidden={!interactive || undefined}
    >
      {children}
      <div ref={dim} className="pointer-events-none absolute inset-0 bg-text" style={initialDim} />
    </section>
  );
}

interface ModalHostProps {
  readonly layerRef: RefObject<HTMLDivElement | null>;
  /** Mounting for a present animation: start off-screen (or transparent with reduced motion). */
  readonly startHidden: boolean;
  readonly reduced: boolean;
  readonly open: boolean;
  readonly children: ReactNode;
}

/** Full-screen modal layer; its starting style is captured once so React never resets the animation. */
function ModalHost({ layerRef, startHidden, reduced, open, children }: ModalHostProps) {
  const [initialStyle] = useState(() =>
    startHidden ? (reduced ? { opacity: 0 } : { transform: 'translateY(100%)' }) : undefined,
  );
  // Hand the starting position to the animation driver (child layout effects run before the navigator's).
  useLayoutEffect(() => {
    if (startHidden) initLayer(layerRef.current, reduced ? { opacity: 0 } : { y: 100 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, like initialStyle
  }, []);
  return (
    <div
      ref={layerRef}
      role="dialog"
      aria-modal="true"
      className="absolute inset-0 z-30 overflow-hidden bg-bg"
      style={initialStyle}
      inert={!open}
    >
      {children}
    </div>
  );
}

interface ScreenBoundaryProps {
  readonly fallback: (props: { readonly reset: () => void }) => ReactNode;
  readonly children: ReactNode;
}

/** Per-screen error boundary: one broken screen never blanks the whole app. */
class ScreenBoundary extends Component<ScreenBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  /** Sends the error to Sentry when reporting is on (T0.13); the screen shows the friendly fallback. */
  override componentDidCatch(error: unknown): void {
    reportError(error);
  }

  override render() {
    if (this.state.failed) {
      return this.props.fallback({
        reset: () => {
          this.setState({ failed: false });
        },
      });
    }
    return this.props.children;
  }
}
