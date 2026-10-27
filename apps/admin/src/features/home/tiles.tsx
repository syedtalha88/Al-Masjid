import type { Tone } from '@mc/ui/components';
import {
  BookOpenIcon,
  ChartBarIcon,
  ClockIcon,
  CrescentIcon,
  GearIcon,
  HandsPrayingIcon,
  HeartIcon,
  ListBulletsIcon,
  MegaphoneIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
} from '@mc/ui/icons';
import type { ReactNode } from 'react';

/**
 * The Admin Home tiles in their final order, icons and colors (07 B3, 06 §2 category mapping; Ruqyah, Blood Camp and
 * Help the Needy from DECISIONS #104). `phase`: the phase that builds the screen — later phases are "Coming soon" in
 * dev/staging builds and hidden in production (PHASE_03 T3.1). `route`: where the tile opens once its task has landed
 * (`null` → "Coming soon" for now).
 */
const TILE_LIST = [
  { key: 'prayerTimes', icon: <ClockIcon size={28} />, tone: 'primary', phase: 3, route: null },
  { key: 'notice', icon: <MegaphoneIcon size={28} />, tone: 'danger', phase: 3, route: null },
  { key: 'hadithAyah', icon: <BookOpenIcon size={28} />, tone: 'info', phase: 3, route: null },
  { key: 'dua', icon: <HandsPrayingIcon size={28} />, tone: 'rose', phase: 3, route: null },
  { key: 'donation', icon: <HeartIcon size={28} filled />, tone: 'heart', phase: 5, route: null },
  { key: 'chanda', icon: <ChartBarIcon size={28} />, tone: 'purple', phase: 5, route: null },
  { key: 'video', icon: <PlayCircleIcon size={28} />, tone: 'primary', phase: 6, route: null },
  { key: 'specialDates', icon: <CrescentIcon size={28} />, tone: 'sun', phase: 3, route: null },
  { key: 'ruqyah', icon: <ShieldCheckIcon size={28} />, tone: 'info', phase: 3, route: null },
  { key: 'bloodCamp', icon: <HeartIcon size={28} />, tone: 'danger', phase: 3, route: null },
  { key: 'needy', icon: <HandsPrayingIcon size={28} />, tone: 'heart', phase: 5, route: null },
  { key: 'myPosts', icon: <ListBulletsIcon size={28} />, tone: 'neutral', phase: 3, route: null },
  { key: 'profile', icon: <GearIcon size={28} />, tone: 'slate', phase: 3, route: null },
] as const satisfies readonly {
  key: string;
  icon: ReactNode;
  tone: Tone;
  phase: number;
  route: string | null;
}[];

export type TileKey = (typeof TILE_LIST)[number]['key'];

export interface Tile {
  readonly key: TileKey;
  readonly icon: ReactNode;
  readonly tone: Tone;
  readonly phase: number;
  /** Set when the tile's task lands; until then the tile opens "Coming soon". */
  readonly route: string | null;
}

export const TILES: readonly Tile[] = TILE_LIST;

/** The phase being built now: tiles of later phases are placeholders. */
export const CURRENT_PHASE = 3;

export const isTileKey = (value: string): value is TileKey => TILES.some((tile) => tile.key === value);

/** Tiles to show: later-phase placeholders only where "Coming soon" screens are allowed (dev / staging). */
export const visibleTiles = (showComingSoon: boolean) =>
  TILES.filter((tile) => showComingSoon || tile.phase <= CURRENT_PHASE);
