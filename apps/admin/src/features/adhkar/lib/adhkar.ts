// B16 editing (07 B16, PHASE_03 T3.14): the switch and the ordered list as the admin changes them, before "Save".
// Pure functions; the server checks the same rules (verified dhikr only, ≤ 30, none twice).
import { ADHKAR_MAX, type AdhkarPut, type AdminAdhkar, type AdminLibraryEntry } from '@mc/shared/contracts';

export interface AdhkarEdit {
  readonly enabled: boolean;
  readonly entries: readonly AdminLibraryEntry[];
}

/** Adds a dhikr at the end — not twice, not past {@link ADHKAR_MAX}. */
export function addDhikr(edit: AdhkarEdit, entry: AdminLibraryEntry): AdhkarEdit {
  if (edit.entries.length >= ADHKAR_MAX || edit.entries.some((chosen) => chosen.id === entry.id)) return edit;
  return { ...edit, entries: [...edit.entries, entry] };
}

/** Moves the entry at `from` to `to` (both in range; anything else changes nothing). */
export function moveDhikr(edit: AdhkarEdit, from: number, to: number): AdhkarEdit {
  const moved = edit.entries[from];
  if (!moved || to < 0 || to >= edit.entries.length || from === to) return edit;
  const entries = edit.entries.filter((_, index) => index !== from);
  entries.splice(to, 0, moved);
  return { ...edit, entries };
}

export function removeDhikr(edit: AdhkarEdit, id: string): AdhkarEdit {
  return { ...edit, entries: edit.entries.filter((entry) => entry.id !== id) };
}

/** The edit differs from what is saved. */
export function adhkarChanged(edit: AdhkarEdit, saved: AdminAdhkar): boolean {
  return (
    edit.enabled !== saved.enabled ||
    edit.entries.length !== saved.entries.length ||
    edit.entries.some((entry, index) => entry.id !== saved.entries[index]?.id)
  );
}

/** The `PUT /adhkar` body. */
export const adhkarBody = (edit: AdhkarEdit): AdhkarPut => ({
  enabled: edit.enabled,
  libraryIds: edit.entries.map((entry) => entry.id),
});
