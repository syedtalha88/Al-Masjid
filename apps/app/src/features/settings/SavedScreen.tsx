// Settings → Saved (07 A15, A8 bookmark): the posts saved on this phone, newest first. Each opens its detail; saving
// kept the item in the persisted cache, so the list works offline.
import { useLocale, useTranslation } from '@mc/i18n/react';
import { MosqueIllustration } from '@mc/ui';
import { Button, Divider, EmptyState, ListRow, SkeletonText } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';

import { templatesQuery } from '../../lib/api/queries.ts';
import { useAppData, useDeviceSelector } from '../../lib/data.tsx';
import { masjidName } from '../../lib/masjid.ts';
import { useItem } from '../content/hooks/useItem.ts';
import { ItemIcon } from '../content/ItemIcon.tsx';
import { itemKind, itemTitle } from '../content/lib/item-view.ts';

export function SavedScreen() {
  const { ready } = useTranslation(['settings', 'content']);
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <Saved />;
}

function Saved() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const saved = useDeviceSelector((state) => state.saved);
  return (
    <Screen title={t('saved')}>
      <div className="pt-2 pb-8">
        {saved.length === 0 ? (
          <EmptyState
            className="pt-8"
            illustration={<MosqueIllustration width={160} />}
            title={t('savedEmpty')}
            body={t('savedEmptyBody')}
            action={
              <Button
                variant="outline"
                onPress={() => {
                  navigator.selectTab('home');
                }}
              >
                {tc('tabs.home')}
              </Button>
            }
          />
        ) : (
          <ul className="overflow-hidden rounded-md bg-surface shadow-e1">
            {saved.map((entry, index) => (
              <Fragment key={entry.publicId}>
                {index > 0 ? <Divider inset="icon" /> : null}
                <li>
                  <SavedRow publicId={entry.publicId} savedAt={entry.savedAt} />
                </li>
              </Fragment>
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}

function SavedRow({ publicId, savedAt }: { readonly publicId: string; readonly savedAt: string }) {
  const { t } = useTranslation('settings');
  const { t: tContent } = useTranslation('content');
  const { t: tc } = useTranslation();
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const { api } = useAppData();
  const templates = useQuery(templatesQuery(api)).data?.templates;
  const state = useItem(publicId);
  const open = () => {
    navigator.push(`/items/${publicId}`);
  };
  const when = t('savedOn', { date: format.date(new Date(savedAt), 'medium') });
  if (state.state === 'loading') {
    return (
      <div aria-busy className="px-4 py-3">
        <SkeletonText lines={2} />
      </div>
    );
  }
  if (state.state !== 'ready') {
    return (
      <ListRow
        className="px-4"
        title={state.state === 'gone' ? tContent('gone') : t('savedUnavailable')}
        meta={when}
        onPress={open}
      />
    );
  }
  const { item, masjid } = state;
  return (
    <ListRow
      className="px-4"
      leading={<ItemIcon item={item} size={44} />}
      title={itemTitle(item, locale, templates, tc(`item.${itemKind(item)}`))}
      {...(masjid ? { subtitle: masjidName(masjid, locale) } : {})}
      meta={when}
      onPress={open}
    />
  );
}
