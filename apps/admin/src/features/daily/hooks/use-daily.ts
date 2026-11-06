// B6 data (07 B6, PHASE_03 T3.7): today's suggestion per kind (with "already one today"); the "Choose another" search
// is `features/library`. A publish refreshes both (`features/publish` invalidates the masjid's queries).
import { useQuery } from '@tanstack/react-query';

import { masjidApi, masjidKeys } from '../../home/api/masjid-api.ts';
import type { DailyKind } from '../lib/daily.ts';

/** Today's suggestion of `kind` — the same all day for the masjid. */
export function useSuggestion(masjidId: string | undefined, kind: DailyKind) {
  const id = masjidId ?? '';
  return useQuery({
    queryKey: masjidKeys.suggestion(id, kind),
    queryFn: ({ signal }) => masjidApi.suggestion(id, kind, signal),
    enabled: masjidId !== undefined,
  });
}
