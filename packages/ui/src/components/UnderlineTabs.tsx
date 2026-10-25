import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { gesture } from '../motion/tokens.ts';
import { animateChannel, getChannel, setChannel } from '../navigation/driver.ts';

export interface UnderlineTab<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
}

export interface UnderlineTabsProps<Id extends string> {
  readonly tabs: readonly UnderlineTab<Id>[];
  readonly value: Id;
  readonly onChange: (id: Id) => void;
  /** Accessible name of the tab list. */
  readonly label: string;
  /** Prefix for tab/panel ids so `TabPanels` can link them (unique per screen). */
  readonly idPrefix: string;
  readonly className?: string;
}

const HIDDEN: CSSProperties = { opacity: 0 };

const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/** Moves focus between tabs with arrow keys (mirrored in RTL), Home and End; selection follows focus. */
function nextIndex(event: KeyboardEvent, index: number, count: number): number | null {
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  switch (event.key) {
    case 'ArrowRight':
      return (index + (rtl ? -1 : 1) + count) % count;
    case 'ArrowLeft':
      return (index + (rtl ? 1 : -1) + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * In-page section tabs (06 §6, ref-1): text tabs with a 2.5 px primary underline that slides to the active
 * tab (`spring.snappy`, transform only, re-targets when interrupted); active text primary-700 semibold.
 * WAI-ARIA tabs pattern: `tablist` / `tab` / `tabpanel`, roving tabindex, arrow keys, Home/End.
 */
export function UnderlineTabs<Id extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: UnderlineTabsProps<Id>) {
  const list = useRef<HTMLDivElement>(null);
  // `animate` is false for the first measurement: the underline appears in place, it does not fly in.
  const [indicator, setIndicator] = useState<{ readonly transform: string; readonly animate: boolean } | null>(null);
  const activeIndex = Math.max(
    tabs.findIndex((tab) => tab.id === value),
    0,
  );

  // Measure the active tab (layout read once per change/resize), then move the indicator by transform only. Read in
  // the ResizeObserver callback — after layout, before paint — never synchronously in a commit: a parent's re-render
  // during navigation forced a page layout inside the tap (perf trace T2.14). Keyed by content, not array identity.
  const tabsKey = tabs.map((tab) => `${tab.id}\u0000${tab.label}`).join('\u0001');
  useEffect(() => {
    const container = list.current;
    if (!container) return;
    const measure = () => {
      const active = container.querySelectorAll<HTMLElement>('[role="tab"]')[activeIndex];
      if (!active) return;
      const box = container.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      const rtl = getComputedStyle(container).direction === 'rtl';
      // The indicator is anchored at the inline start; in RTL that is the right edge.
      const offset = rtl ? tab.right - box.right : tab.left - box.left;
      const transform = `translateX(${String(offset)}px) scaleX(${String(tab.width / 100)})`;
      setIndicator((current) => ({ transform, animate: current !== null }));
    };
    // A new observer per change: its first callback (after the next layout) measures; later ones follow resizes.
    if (typeof ResizeObserver === 'undefined') {
      measure();
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [activeIndex, tabsKey]);

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className={`relative flex border-b border-border ${className ?? ''}`}
    >
      {tabs.map((tab, index) => {
        const selected = index === activeIndex;
        return (
          <Pressable
            key={tab.id}
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onPress={() => {
              onChange(tab.id);
            }}
            onKeyDown={(event) => {
              const next = nextIndex(event, index, tabs.length);
              if (next === null) return;
              event.preventDefault();
              const target = tabs[next];
              if (!target) return;
              onChange(target.id);
              list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
            }}
            className={`min-h-11 flex-1 px-3 type-callout whitespace-nowrap transition-state ${
              selected ? 'font-semibold text-primary-700' : 'text-text-secondary'
            }`}
          >
            {tab.label}
          </Pressable>
        );
      })}
      {/* 100 px wide, scaled to the tab width; origin at the inline start (left in LTR, right in RTL). */}
      <span
        aria-hidden
        className={`pointer-events-none absolute start-0 -bottom-px h-[2.5px] w-[100px] origin-left rounded-full bg-primary-700 rtl:origin-right ${
          indicator?.animate ? 'transition-indicator' : ''
        }`}
        style={indicator ? { transform: indicator.transform } : HIDDEN}
      />
    </div>
  );
}

export interface TabPanelsProps<Id extends string> {
  readonly tabs: readonly UnderlineTab<Id>[];
  readonly value: Id;
  readonly idPrefix: string;
  /** Enables horizontal swipe between panels (08 §5.2). */
  readonly onChange?: (id: Id) => void;
  /** Renders the active panel's content. */
  readonly children: (id: Id) => ReactNode;
  readonly className?: string;
}

/** px → % of the element's own width (the driver's `x` unit). */
const percentOf = (node: HTMLElement, px: number) => (node.offsetWidth > 0 ? (px / node.offsetWidth) * 100 : 0);

/** Finger travel that changes the panel on release, px. */
const SWIPE_COMMIT_PX = 64;

/**
 * The panel for the active tab (08 §5.2): slides in ±24 px + fades (`tween.quick`) in the direction of the
 * change, mirrored in RTL; reduced motion fades only. With `onChange`, a horizontal swipe moves the panel with
 * the finger (with resistance at the first/last tab) and changes tab on release past 64 px or a flick.
 * Swipes that start inside a horizontal scroller (`.scroller-x`, `[data-no-swipe]`) are left alone.
 */
export function TabPanels<Id extends string>({
  tabs,
  value,
  idPrefix,
  onChange,
  children,
  className,
}: TabPanelsProps<Id>) {
  const { reduced } = useMotionPrefs();
  const panel = useRef<HTMLDivElement>(null);
  const index = tabs.findIndex((tab) => tab.id === value);
  const previous = useRef(index);
  const swipe = useRef<{ id: number; x: number; y: number; time: number; active: boolean } | null>(null);

  useEffect(() => {
    const node = panel.current;
    const from = previous.current;
    previous.current = index;
    if (!node || from === index) return;
    const rtl = getComputedStyle(node).direction === 'rtl';
    const direction = (index > from ? 1 : -1) * (rtl ? -1 : 1);
    setChannel(node, 'opacity', 0);
    void animateChannel(node, 'opacity', 1, reduced ? 'fade' : 'quick');
    if (reduced) setChannel(node, 'x', 0);
    else {
      // From where a swipe left it (or ±24 px), back to rest.
      if (getChannel(node, 'x') === 0) setChannel(node, 'x', percentOf(node, 24 * direction));
      void animateChannel(node, 'x', 0, 'quick');
    }
  }, [index, reduced]);

  const swipeHandlers = onChange
    ? {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          if (event.target instanceof Element && event.target.closest('.scroller-x, [data-no-swipe]')) return;
          swipe.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            time: event.timeStamp,
            active: false,
          };
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
          const current = swipe.current;
          const node = panel.current;
          if (current?.id !== event.pointerId || !node) return;
          const dx = event.clientX - current.x;
          const dy = event.clientY - current.y;
          if (!current.active) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
              swipe.current = null;
              return;
            }
            if (Math.abs(dx) < 10) return;
            current.active = true;
            node.setPointerCapture(event.pointerId);
          }
          // Towards a missing neighbour (first/last tab) the panel resists.
          const rtl = getComputedStyle(node).direction === 'rtl';
          const step = (dx < 0 ? 1 : -1) * (rtl ? -1 : 1);
          const hasNeighbour = index + step >= 0 && index + step < tabs.length;
          setChannel(node, 'x', percentOf(node, dx * (hasNeighbour ? 0.5 : 0.15)));
        },
        onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
          const current = swipe.current;
          swipe.current = null;
          const node = panel.current;
          if (current?.id !== event.pointerId || !current.active || !node) return;
          const dx = event.clientX - current.x;
          const seconds = Math.max((event.timeStamp - current.time) / 1000, 0.01);
          const flick = Math.abs(dx) / seconds > gesture.dismissVelocity;
          const rtl = getComputedStyle(node).direction === 'rtl';
          const step = (dx < 0 ? 1 : -1) * (rtl ? -1 : 1);
          const target = tabs[index + step];
          if (target && (Math.abs(dx) > SWIPE_COMMIT_PX || flick)) onChange(target.id);
          else void animateChannel(node, 'x', 0, 'smooth');
        },
        onPointerCancel: () => {
          swipe.current = null;
          void animateChannel(panel.current, 'x', 0, 'smooth');
        },
      }
    : {};

  return (
    <div
      ref={panel}
      role="tabpanel"
      id={panelId(idPrefix, value)}
      aria-labelledby={tabId(idPrefix, value)}
      className={`${onChange ? 'touch-pan-y' : ''} ${className ?? ''}`}
      {...swipeHandlers}
    >
      {children(value)}
    </div>
  );
}
