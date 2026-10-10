import type { ComponentType } from 'react';

import { Pressable } from '../motion/Pressable.tsx';
import type { NavigatorApi } from './context.ts';
import { ScanIcon, type WeightedIconProps } from './icons.tsx';

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly Icon: ComponentType<WeightedIconProps>;
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
        <Icon weight={active ? 'fill' : 'regular'} />
        <span>{item.label}</span>
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
          <Pressable
            kind="fab"
            onPress={() => {
              api.presentModal(scan.href);
            }}
            onPointerDown={() => {
              api.preload(scan.href);
            }}
            aria-label={scan.label}
            data-tab-button="scan"
            className="-mt-4.5 inline-flex size-14 items-center justify-center rounded-full bg-primary-700 text-on-primary shadow-fab ring-4 ring-surface"
          >
            <ScanIcon size={26} />
          </Pressable>
        </li>
        {end.map(item)}
      </ul>
    </nav>
  );
}
