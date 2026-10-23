import { haptic } from '@mc/ui/motion';
import { useState } from 'react';

import { useFollowedIds } from '../../lib/data.tsx';
import { useFollow } from './useFollow.ts';

export type FollowPhase = 'preview' | 'busy' | 'followed' | 'opened' | 'limit';

export interface FollowFlow {
  readonly phase: FollowPhase;
  /** Already followed on this device (and not just followed now). */
  readonly already: boolean;
  /** "Follow masjid": success → `followed` (the caller plays the check, then opens the masjid). */
  readonly follow: () => Promise<void>;
  /** The success check finished: open the masjid — once (the check may replay while a sheet animates out). */
  readonly complete: () => void;
  readonly reset: () => void;
}

/**
 * One masjid's follow button state (preview sheet and `/m/:code` landing): follow → success haptic + `followed`; at the
 * 20-masjid limit → warning haptic + `limit`; followed meanwhile (another tab) → `onOpen` at once.
 */
export function useFollowFlow(masjidId: string | null, onOpen: (masjidId: string) => void): FollowFlow {
  const followMasjid = useFollow();
  const followed = useFollowedIds();
  const [phase, setPhase] = useState<FollowPhase>('preview');
  const already = masjidId !== null && phase === 'preview' && followed.includes(masjidId);
  return {
    phase,
    already,
    follow: async () => {
      if (masjidId === null || phase !== 'preview') return;
      setPhase('busy');
      const result = await followMasjid(masjidId);
      if (result === 'limit') {
        haptic('warning');
        setPhase('limit');
      } else if (result === 'already') {
        setPhase('preview');
        onOpen(masjidId);
      } else {
        haptic('success');
        setPhase('followed');
      }
    },
    complete: () => {
      if (masjidId === null || phase !== 'followed') return;
      setPhase('opened');
      onOpen(masjidId);
    },
    reset: () => {
      setPhase('preview');
    },
  };
}
