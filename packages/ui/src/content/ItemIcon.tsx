// The icon circle of a feed item in lists (06 §2 "Category → color mapping").
import type { FeedItem } from '@mc/shared/contracts/public';
import type { ReactNode } from 'react';

import { IconCircle } from '../components/IconCircle.tsx';
import type { Tone } from '../components/tone.ts';
import {
  BookOpenIcon,
  CalendarIcon,
  ChartBarIcon,
  ClockIcon,
  HandsPrayingIcon,
  HeartIcon,
  InfoIcon,
  MegaphoneIcon,
  PlayCircleIcon,
  WrenchIcon,
} from '../icons/glyphs.tsx';
import { itemKind } from './item-view.ts';

export const DUA_TONE: Readonly<Record<'illness' | 'inteqal' | 'other', Tone>> = {
  illness: 'rose',
  inteqal: 'slate',
  other: 'primary',
};

function iconOf(item: FeedItem): { readonly icon: ReactNode; readonly tone: Tone } {
  const kind = itemKind(item);
  switch (kind) {
    case 'announcement':
      return item.isImportant ? { icon: <MegaphoneIcon />, tone: 'danger' } : { icon: <InfoIcon />, tone: 'info' };
    case 'event':
      return { icon: <CalendarIcon />, tone: 'primary' };
    case 'facilities':
      return { icon: <WrenchIcon />, tone: 'sun' };
    case 'timing':
      return { icon: <ClockIcon />, tone: 'primary' };
    case 'hadith':
    case 'ayah':
      return { icon: <BookOpenIcon />, tone: 'info' };
    case 'dua':
      return { icon: <HandsPrayingIcon />, tone: DUA_TONE[item.dua?.category ?? 'other'] };
    case 'campaign':
      return { icon: <HeartIcon />, tone: 'heart' };
    case 'chanda':
      return { icon: <ChartBarIcon />, tone: 'purple' };
    case 'video':
      return { icon: <PlayCircleIcon />, tone: 'primary' };
  }
}

/** The category icon circle of a feed item (lists 48, dua cards 56). */
export function ItemIcon({ item, size = 48 }: { readonly item: FeedItem; readonly size?: 44 | 48 | 56 }) {
  const { icon, tone } = iconOf(item);
  return (
    <IconCircle tone={tone} size={size}>
      {icon}
    </IconCircle>
  );
}
