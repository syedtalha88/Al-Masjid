// Which of the admin's masjids the Home screen works on (07 B3 "switcher chevron if multiple masjids"). Remembered
// per browser as a convenience only; falls back to the first membership when the stored one is gone.
import type { AdminMe } from '@mc/shared/contracts';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'mc.admin.masjid';

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode / storage blocked: the choice just isn't remembered.
  }
}

export type AdminMasjid = AdminMe['masjids'][number];

/**
 * The selected masjid and a setter.
 *
 * @returns `masjid` is `undefined` only when the admin has no masjid at all.
 */
export function useSelectedMasjid(masjids: readonly AdminMasjid[]): {
  masjid: AdminMasjid | undefined;
  select: (id: string) => void;
} {
  const [selected, setSelected] = useState<string | null>(readStored);
  const masjid = masjids.find((m) => m.id === selected) ?? masjids[0];
  const select = useCallback((id: string) => {
    writeStored(id);
    setSelected(id);
  }, []);
  return { masjid, select };
}
