import type { ReactNode } from 'react';

import { CountBadge } from '../components/Badges.tsx';
import { IconCircle } from '../components/IconCircle.tsx';
import type { Tone } from '../components/tone.ts';
import { Pressable, type PressableProps } from '../motion/Pressable.tsx';

export interface AdminTileProps extends Omit<PressableProps, 'kind' | 'children'> {
  /** Category icon (decorative — the label names the tile). */
  readonly icon: ReactNode;
  readonly tone: Tone;
  /** Tile label, two lines at most. */
  readonly label: string;
  /** Optional count (e.g. drafts, inbox items). */
  readonly badge?: number;
}

/**
 * Admin Home tile (06 §6 admin components, 07 B3): white card, radius 20, min-height 132, a 56px category icon circle
 * and a two-line label in the admin type scale. One tap target (press scale 0.98), ≥ 56px in both directions.
 */
export function AdminTile({ icon, tone, label, badge, className, ...rest }: AdminTileProps) {
  return (
    <Pressable
      {...rest}
      kind="card"
      className={`relative flex min-h-[132px] w-full flex-col items-start justify-between gap-3 rounded-lg bg-surface p-4 text-start shadow-e1 ${
        className ?? ''
      }`}
    >
      <IconCircle tone={tone} size={56}>
        {icon}
      </IconCircle>
      <span className="line-clamp-2 type-headline text-text">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="absolute end-3 top-3">
          <CountBadge count={badge} />
        </span>
      ) : null}
    </Pressable>
  );
}
