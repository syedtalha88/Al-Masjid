// A19 Ruqyah (07 A19, DECISIONS #104): the masjid's entries under their headings — Protection from Nazar · Protection
// from black magic · Healing (Shifa) · Daily protection · General (only non-empty ones, in this order), each in the
// masjid's order. Library entries carry their source line, the masjid's own text "Added by <masjid>", recordings the A18
// player; the masjid's instruction sits under its entry. The list is versioned like the feed (immutable per `v`) and kept
// for offline use once opened. Texts only from the verified library or from the masjid (CLAUDE.md §2.3).
import { useLocale, useTranslation } from '@mc/i18n/react';
import { MosqueIllustration } from '@mc/ui';
import { Button, EmptyState, SectionHeader, Skeleton, SkeletonGroup, SkeletonText, Switch } from '@mc/ui/components';
import { RuqyahCard } from '@mc/ui/content';
import { RefreshIcon } from '@mc/ui/icons';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';

import { ruqyahQuery } from '../../lib/api/queries.ts';
import { useAppData, useDeviceSelector } from '../../lib/data.tsx';
import { masjidName } from '../../lib/masjid.ts';
import { audioUrl } from '../../lib/media.ts';
import { useMasjidDetail } from '../masjid/hooks/useMasjidDetail.ts';
import { ContentGate } from './components/ContentGate.tsx';

export function RuqyahScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <RuqyahList masjidId={params['masjidId'] ?? ''} />
    </ContentGate>
  );
}

function RuqyahList({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('content');
  const { t: tm } = useTranslation('masjid');
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  const navigator = useNavigator();
  const { api, store } = useAppData();
  const showTransliteration = useDeviceSelector((state) => state.settings.transliteration);
  const scale = useDeviceSelector((state) => state.settings.arabicScale);
  const { masjid } = useMasjidDetail(masjidId);
  const bundle = masjid.state === 'active' ? masjid.bundle : null;
  const list = useQuery({ ...ruqyahQuery(api, masjidId, bundle?.v ?? 0), enabled: bundle !== null });
  const sections = list.data?.sections ?? [];
  const name = bundle ? masjidName(bundle.masjid, locale) : '';
  const anyTransliteration = sections.some((section) =>
    section.entries.some((entry) => entry.library?.transliteration.en !== undefined),
  );
  const back = (
    <Button
      variant="outline"
      onPress={() => {
        navigator.back();
      }}
    >
      {t('back')}
    </Button>
  );

  const body = (() => {
    if (masjid.state === 'suspended' || masjid.state === 'gone') {
      return <EmptyState className="pt-8" title={tm(masjid.state)} action={back} />;
    }
    if (masjid.state === 'loading' || (bundle && list.isPending)) {
      return (
        <SkeletonGroup className="flex flex-col gap-4">
          <Skeleton className="h-6 w-1/2 rounded-xs" />
          {[0, 1].map((row) => (
            <span key={row} className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1">
              <Skeleton className="h-10 w-full rounded-xs" />
              <SkeletonText lines={2} />
            </span>
          ))}
        </SkeletonGroup>
      );
    }
    if (masjid.state === 'failed' || list.isError) {
      return (
        <EmptyState
          className="pt-8"
          illustration={<MosqueIllustration width={160} />}
          title={t('ruqyahFailed')}
          body={t('ruqyahFailedBody')}
          action={
            <Button
              variant="secondary"
              leadingIcon={<RefreshIcon />}
              onPress={() => {
                void list.refetch();
              }}
            >
              {tc('ui.refresh')}
            </Button>
          }
        />
      );
    }
    if (sections.length === 0) {
      return (
        <EmptyState
          className="pt-8"
          illustration={<MosqueIllustration width={160} />}
          title={t('emptyRuqyah')}
          body={t('emptyRuqyahBody')}
          action={back}
        />
      );
    }
    return (
      <>
        {anyTransliteration ? (
          <Switch
            checked={showTransliteration}
            label={t('transliteration')}
            onChange={(checked) => {
              void store.update((current) => ({
                ...current,
                settings: { ...current.settings, transliteration: checked },
              }));
            }}
          />
        ) : null}
        {sections.map((section) => (
          <section key={section.category} className="flex flex-col gap-3" data-ruqyah-section={section.category}>
            <SectionHeader title={tc(`ui.ruqyah.category.${section.category}`)} />
            <ol className="flex flex-col gap-4">
              {section.entries.map((entry) => (
                <li key={entry.id}>
                  <RuqyahCard
                    entry={entry}
                    masjid={name}
                    audioSrc={entry.audio ? audioUrl(entry.audio.key) : null}
                    scale={scale}
                    showTransliteration={showTransliteration}
                  />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </>
    );
  })();

  return (
    <Screen title={tc('ui.ruqyah.title')} {...(bundle ? { subtitle: name } : {})}>
      <div className="flex flex-col gap-5 pt-2 pb-6" data-ruqyah-list>
        {body}
      </div>
    </Screen>
  );
}
