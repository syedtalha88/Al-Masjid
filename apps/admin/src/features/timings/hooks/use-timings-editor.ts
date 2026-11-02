// The B4 editor's state (07 B4): the saved schedule (shared with the Admin Home's query), the draft being edited, and the
// save — at the revision the draft started from, so a save over someone else's change fails (412) instead of
// overwriting it.
import type { AdminSchedule } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';
import { type Draft, draftOf, saveBody } from '../lib/editor.ts';

/** What stopped a save that the admin can act on. */
export type SaveProblem = 'conflict' | 'quota' | 'other' | null;

const problemOf = (error: unknown): SaveProblem => {
  if (!error) return null;
  if (error instanceof ProblemError && error.problem.code === 'PRECONDITION_FAILED') return 'conflict';
  if (error instanceof ProblemError && error.problem.code === 'NOTIFY_QUOTA_EXCEEDED') return 'quota';
  return 'other';
};

/**
 * @param masjidId - the selected masjid (the query waits for it).
 * @returns the loaded schedule, the draft (`null` until loaded), the saved draft to compare with (`null` before the
 *   first save), `save(notify)`, and `reload()` after a conflict (drops the draft, starts again from the latest save).
 */
export function useTimingsEditor(masjidId: string | undefined) {
  const queryClient = useQueryClient();
  const id = masjidId ?? '';
  const schedule = useQuery({
    queryKey: masjidKeys.schedule(id),
    queryFn: ({ signal }) => masjidApi.schedule(id, signal),
    enabled: masjidId !== undefined,
  });
  /** The schedule the draft was started from (its `rev` goes into `If-Match`). */
  const [base, setBase] = useState<AdminSchedule | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (schedule.data && base === null) {
    setBase(schedule.data);
    setDraft(draftOf(schedule.data));
  }

  const save = useMutation({
    mutationFn: ({ notify }: { readonly notify: boolean }) => {
      if (!base || !draft) throw new Error('nothing loaded'); // the screen saves only once loaded
      return masjidApi.saveTimings(id, base.rev, saveBody(draft, notify));
    },
    onSuccess: async (saved) => {
      if (base && draft) {
        // What was stored is exactly what was sent.
        const { notify: _notify, ...timings } = saveBody(draft, false);
        setBase({ ...base, timings, rev: saved.rev });
      }
      // Home's today strip, the quota pill (a notifying save) and the stats follow.
      await queryClient.invalidateQueries({ queryKey: masjidKeys.all(id) });
    },
  });

  const reload = async () => {
    save.reset();
    const fresh = await schedule.refetch();
    if (fresh.data) {
      setBase(fresh.data);
      setDraft(draftOf(fresh.data));
    }
  };

  return {
    schedule,
    masjid: base?.masjid ?? null,
    saved: base?.timings ?? null,
    draft,
    setDraft,
    save,
    problem: problemOf(save.error),
    reload,
  };
}
