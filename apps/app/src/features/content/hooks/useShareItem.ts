// Share a post (07 A7–A9 Share): the system share sheet when available, else our sheet (WhatsApp / Copy link). The
// link is the public landing `/p/:publicId`; the text is "<title> — <masjid>".
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem, MasjidSummary } from '@mc/shared/contracts/public';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { templatesQuery } from '../../../lib/api/queries.ts';
import { useAppData } from '../../../lib/data.tsx';
import { masjidName } from '../../../lib/masjid.ts';
import { shareNatively, type ShareTarget } from '../../masjid/components/ShareSheet.tsx';
import { itemLink } from '../lib/actions.ts';
import { itemKind, itemTitle } from '../lib/item-view.ts';

export function useShareItem() {
  const { t } = useTranslation('content');
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  const { api } = useAppData();
  const templates = useQuery(templatesQuery(api)).data?.templates;
  const [target, setTarget] = useState<ShareTarget | null>(null);

  const open = useCallback(
    (item: FeedItem, masjid: MasjidSummary | null) => {
      const title = itemTitle(item, locale, templates, tc(`item.${itemKind(item)}`));
      const name = masjid ? masjidName(masjid, locale) : '';
      const next: ShareTarget = {
        name: title,
        url: itemLink(window.location.origin, item.publicId),
        text: name ? t('shareItemText', { title, masjid: name }) : title,
      };
      void shareNatively(next).then((shared) => {
        if (!shared) setTarget(next);
      });
    },
    [locale, templates, t, tc],
  );
  const close = useCallback(() => {
    setTarget(null);
  }, []);
  return { target, open, close };
}
