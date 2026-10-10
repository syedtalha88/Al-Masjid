import type { ComponentType } from 'react';

import { CountBadge } from '../components/Badges.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import type { NavigatorApi } from './context.ts';
import { ScanIcon, type WeightedIconProps } from './icons.tsx';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly Icon: ComponentType<WeightedIconProps>;
  /** Unseen items (Updates — 06 §6): a red count on the icon, part of the tab's accessible name. */
  readonly badge?: number;
}

export interface TabBarProps {
  readonly api: NavigatorApi;
  /** Two tabs on each side of the Scan button (06 §6: Home, My Masjids, Scan, Updates, Settings). */
  readonly start: readonly [TabItem, TabItem];
  readonly end: readonly [TabItem, TabItem];
  /** Accessible name of the tab bar landmark. */
  readonly label: string;
  readonly scan: { readonly label: string; readonly href: string };
}

function TabButton({ item, active, onSelect }: { item: TabItem; active: boolean; onSelect: () => void }) {
  const { Icon } = item;
  return (
    <li className="flex flex-1">
      <Pressable
        onPress={onSelect}
        aria-current={active ? 'page' : undefined}
        data-tab-button={item.id}
        className={`flex min-h-11 w-full flex-col items-center justify-center gap-0.5 type-micro ${
          active ? 'text-primary-700' : 'text-text-tertiary'
        }`}
      >
        {/* The visible badge sits on the icon; the spoken count follows the label ("Updates, 3 new"). */}
        <span className="relative inline-flex" aria-hidden>
          <Icon weight={active ? 'fill' : 'regular'} />
          {item.badge ? <CountBadge count={item.badge} className="absolute -top-1.5 -end-2.5" /> : null}
        </span>
        <span>{item.label}</span>
        {item.badge ? (
          <span className="sr-only">
            {', '}
            <CountBadge count={item.badge} />
          </span>
        ) : null}
      </Pressable>
    </li>
  );
}

/**
 * Tab bar (06 §6): 64px + safe area, surface with a top hairline, raised circular Scan FAB in the middle.
 * Tapping the active tab pops to its root and scrolls to top (navigator `selectTab`).
 */
export function TabBar({ api, start, end, label, scan }: TabBarProps) {
  const item = (tab: TabItem) => (
    <TabButton
      key={tab.id}
      item={tab}
      active={api.activeTab === tab.id}
      onSelect={() => {
        api.selectTab(tab.id);
      }}
    />
  );
  return (
    <nav
      aria-label={label}
      className="absolute inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-safe px-safe"
    >
      <ul className="mx-auto flex h-16 max-w-content items-stretch">
        {start.map(item)}
        <li className="flex flex-1 justify-center">
          <ScanFab
            label={scan.label}
            onPress={() => {
              api.presentModal(scan.href);
            }}
            onPointerDown={() => {
              api.preload(scan.href);
            }}
          />
        </li>
        {end.map(item)}
      </ul>
    </nav>
  );
}

export interface ScanFabProps {
  /** Accessible name ("Scan QR code"). */
  readonly label: string;
  readonly onPress: () => void;
  /** Start loading the scanner's code on touch, before the tap completes. */
  readonly onPointerDown?: () => void;
}

/**
 * Raised circular Scan button (06 §6 ScanFab): 56 px primary-700 circle, white scan glyph, lifted −18 px
 * above the tab bar with the `fab` shadow and a 4 px surface ring; press scale 0.92 (08 §3.3).
 */
export function ScanFab({ label, onPress, onPointerDown }: ScanFabProps) {
  return (
    <Pressable
      kind="fab"
      onPress={onPress}
      {...(onPointerDown ? { onPointerDown } : {})}
      aria-label={label}
      data-tab-button="scan"
      className="-mt-4.5 inline-flex size-14 items-center justify-center rounded-full bg-primary-700 text-on-primary shadow-fab ring-4 ring-surface"
    >
      <ScanIcon size={26} />
    </Pressable>
  );
}
