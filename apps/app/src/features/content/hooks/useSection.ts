// A masjid's section list (07 A7–A9): its items of one type (paged like Updates, one masjid only) and the masjid's
// name / availability for the bar.
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { ItemType, MasjidSummary } from '@mc/shared/contracts/public';
import { useMemo } from 'react';

import { masjidName } from '../../../lib/masjid.ts';
import { useMasjidDetail } from '../../masjid/hooks/useMasjidDetail.ts';
import { type Timeline, useTimeline } from '../../updates/hooks/useTimeline.ts';

export interface Section {
  readonly timeline: Timeline;
  /** The masjid's name (bar subtitle), once known. */
  readonly name: string | undefined;
  /** The masjid (share text, saved items), once known. */
  readonly profile: MasjidSummary | null;
  /** Why the list cannot show (suspended / no longer listed). */
  readonly unavailable: string | undefined;
}

export function useSection(masjidId: string, type: ItemType): Section {
  const { t } = useTranslation('masjid');
  const { locale } = useLocale();
  const only = useMemo(() => [masjidId], [masjidId]);
  const timeline = useTimeline(type, only);
  const { masjid } = useMasjidDetail(masjidId);
  return {
    timeline,
    name: masjid.state === 'active' ? masjidName(masjid.bundle.masjid, locale) : undefined,
    profile: masjid.state === 'active' ? masjid.bundle.masjid : null,
    unavailable: masjid.state === 'suspended' ? t('suspended') : masjid.state === 'gone' ? t('gone') : undefined,
  };
}
