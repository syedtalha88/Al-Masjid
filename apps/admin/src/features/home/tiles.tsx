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
} from '@mc/ui/icons';
import type { ReactNode } from 'react';

/** The ten Admin Home tiles in their final order, icons and colors (07 B3, 06 §2 category mapping). */
export const TILES = [
  { key: 'prayerTimes', icon: <ClockIcon size={28} />, tone: 'primary' },
  { key: 'notice', icon: <MegaphoneIcon size={28} />, tone: 'danger' },
  { key: 'hadithAyah', icon: <BookOpenIcon size={28} />, tone: 'info' },
  { key: 'dua', icon: <HandsPrayingIcon size={28} />, tone: 'rose' },
  { key: 'donation', icon: <HeartIcon size={28} filled />, tone: 'heart' },
  { key: 'chanda', icon: <ChartBarIcon size={28} />, tone: 'purple' },
  { key: 'video', icon: <PlayCircleIcon size={28} />, tone: 'primary' },
  { key: 'specialDates', icon: <CrescentIcon size={28} />, tone: 'sun' },
  { key: 'myPosts', icon: <ListBulletsIcon size={28} />, tone: 'neutral' },
  { key: 'profile', icon: <GearIcon size={28} />, tone: 'slate' },
] as const satisfies readonly { key: string; icon: ReactNode; tone: Tone }[];

export type TileKey = (typeof TILES)[number]['key'];

export const isTileKey = (value: string): value is TileKey => TILES.some((tile) => tile.key === value);
