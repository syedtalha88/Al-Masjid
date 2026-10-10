import { createContext, use } from 'react';

import type { Entry } from './model.ts';

export interface ScreenInfo {
  readonly entry: Entry;
  readonly tab: string;
  /** 1-based position in its tab stack (1 = tab root). */
  readonly depth: number;
  /** Top of the active tab (interactive, not covered). */
  readonly isTop: boolean;
  readonly params: Readonly<Record<string, string>>;
  readonly search: Readonly<Record<string, string>>;
  /** Rendered inside the full-screen modal layer. */
  readonly isModal: boolean;
}

export interface NavigatorApi {
  readonly activeTab: string;
  /** Pushes a screen onto the active tab. */
  push(href: string): void;
  /** Pops the top screen (or closes the modal). Works for deep links (replaces onto the tab root). */
  back(): void;
  /** Tab bar tap: switches tab, or pops to root + scrolls to top when the tab is already active. */
  selectTab(tab: string): void;
  presentModal(href: string): void;
  /** Starts loading a screen's code early (call on press). */
  preload(href: string): void;
}

export const ScreenContext = createContext<ScreenInfo | null>(null);
export const NavigatorContext = createContext<NavigatorApi | null>(null);

/**
 * The current screen: its own params/search (frozen to its history entry). Screens must use this instead of
 * the router's `useParams`/`useSearch`, which follow the *current* URL even for covered screens.
 */
export function useScreen(): ScreenInfo {
  const screen = use(ScreenContext);
  if (!screen) throw new Error('useScreen() must be used inside a screen rendered by <StackNavigator>');
  return screen;
}

export function useNavigator(): NavigatorApi {
  const navigator = use(NavigatorContext);
  if (!navigator) throw new Error('useNavigator() must be used inside <StackNavigator>');
  return navigator;
}
