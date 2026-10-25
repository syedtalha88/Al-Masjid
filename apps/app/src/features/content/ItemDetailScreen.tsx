// `/items/:publicId` (07 Navigation map: any item detail). Announcement detail (07 A7: icon + title, masjid row, full
// body, photo → full-screen pinch-zoom viewer, event date with "Add to calendar" (.ics), Share, "edited"), the Read
// Full reader for hadith / ayah (07 A8: Arabic size A−/A+ remembered, transliteration toggle, translation, reference,
// source + licence, copy, Share, Save) and the dua detail (07 A9: full message, full dua, large Ameen, janaza). Other
// types (campaigns, videos, chanda — Phases 5/6) show their title and text for now. Report ("…") arrives with Phase 8.
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem, MasjidSummary } from '@mc/shared/contracts/public';
import { MosqueIllustration } from '@mc/ui';
import {
  AmeenButton,
  ArabicText,
  Button,
  Card,
  DuaBox,
  EmptyState,
  IconButton,
  Image,
  ImageViewer,
  Skeleton,
  SkeletonText,
  Switch,
  Tag,
  useToast,
} from '@mc/ui/components';
import { BookmarkIcon, CalendarIcon, ClockIcon, CopyIcon, DownloadIcon, ShareIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useState } from 'react';

import { templatesQuery } from '../../lib/api/queries.ts';
import { now as correctedNow, useNow } from '../../lib/clock.ts';
import { useAppData, useDeviceSelector } from '../../lib/data.tsx';
import { masjidName } from '../../lib/masjid.ts';
import { mediaUrl } from '../../lib/media.ts';
import { ShareSheet } from '../masjid/components/ShareSheet.tsx';
import { eventLabel, TAG_TONE } from './AnnouncementsScreen.tsx';
import { ContentGate } from './components/ContentGate.tsx';
import { DUA_TAG_TONE, janazaWhen } from './DuasScreen.tsx';
import { useAmeen } from './hooks/useAmeen.ts';
import { useItem } from './hooks/useItem.ts';
import { useNoticeBody } from './hooks/useNoticeBody.ts';
import { useSaved } from './hooks/useSaved.ts';
import { useShareItem } from './hooks/useShareItem.ts';
import { ItemIcon } from './ItemIcon.tsx';
import { downloadFile, eventFile } from './lib/actions.ts';
import { announcementTags, duaPerson, libraryText } from './lib/content-view.ts';
import { itemKind, itemTitle } from './lib/item-view.ts';

/** Reader text size steps (07 A8 A−/A+; the device store allows 0.8–1.6). */
const SCALE_STEP = 0.1;
const SCALE_MIN = 0.8;
const SCALE_MAX = 1.6;

/**
 * How a detail renders: in the app (default), or read-only on the `/p/:publicId` landing (07 A16) — no Ameen button
 * (the count still shows) and no bookmark, with the landing's own actions at the end.
 */
export interface DetailMode {
  readonly readOnly: boolean;
  readonly footer?: ReactNode;
}
const DetailModeContext = createContext<DetailMode>({ readOnly: false });

export function ItemDetailScreen() {
  const { params } = useScreen();
  return (
    <ContentGate>
      <ItemDetail publicId={params['publicId'] ?? ''} />
    </ContentGate>
  );
}

/** One item's detail — the in-app screen, or (with `mode`) the post landing. */
export function ItemDetailView({ publicId, mode }: { readonly publicId: string; readonly mode: DetailMode }) {
  return (
    <DetailModeContext value={mode}>
      <ItemDetail publicId={publicId} />
    </DetailModeContext>
  );
}

function ItemDetail({ publicId }: { readonly publicId: string }) {
  const { t } = useTranslation('content');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const state = useItem(publicId);

  if (state.state === 'loading') {
    return (
      <Screen title={tc('home.updates')}>
        <div aria-busy className="flex flex-col gap-4 pt-4">
          <Skeleton className="size-14 rounded-full" />
          <SkeletonText lines={5} />
        </div>
      </Screen>
    );
  }
  if (state.state !== 'ready') {
    const gone = state.state === 'gone';
    return (
      <Screen title={tc('home.updates')}>
        <EmptyState
          className="pt-8"
          illustration={gone ? <MosqueIllustration width={160} /> : undefined}
          title={gone ? t('gone') : tc('appError.title')}
          body={gone ? t('goneBody') : tc('appError.body')}
          action={
            gone ? (
              <Button
                variant="outline"
                onPress={() => {
                  navigator.back();
                }}
              >
                {t('back')}
              </Button>
            ) : (
              <Button variant="outline" onPress={state.retry}>
                {tc('appError.retry')}
              </Button>
            )
          }
        />
      </Screen>
    );
  }
  const { item, masjid } = state;
  if (item.type === 'daily_content' && item.daily?.library) return <Reader item={item} masjid={masjid} />;
  if (item.type === 'dua_request' && item.dua) return <DuaDetail item={item} masjid={masjid} />;
  return <NoticeDetail item={item} masjid={masjid} />;
}

interface DetailProps {
  readonly item: FeedItem;
  readonly masjid: MasjidSummary | null;
}

/** The landing's own actions (Follow, get the app) — nothing in the app. */
function LandingFooter() {
  const { footer } = use(DetailModeContext);
  return footer ? <>{footer}</> : null;
}

function useMasjidLabel(masjid: MasjidSummary | null): string | undefined {
  const { locale } = useLocale();
  return masjid ? masjidName(masjid, locale) : undefined;
}

function ShareButton({ item, masjid }: DetailProps) {
  const { t } = useTranslation('content');
  const share = useShareItem();
  return (
    <>
      <Button
        variant="outline"
        fullWidth
        leadingIcon={<ShareIcon />}
        onPress={() => {
          share.open(item, masjid);
        }}
      >
        {t('share')}
      </Button>
      <ShareSheet target={share.target} title={t('share')} onClose={share.close} />
    </>
  );
}

/** Announcements and the types later phases detail (title, text, photo). */
function NoticeDetail({ item, masjid }: DetailProps) {
  const { t } = useTranslation('content');
  const { t: tc } = useTranslation();
  const { locale, format } = useLocale();
  const { api } = useAppData();
  const now = useNow();
  const templates = useQuery(templatesQuery(api)).data?.templates;
  const body = useNoticeBody(item);
  const name = useMasjidLabel(masjid);
  const [viewing, setViewing] = useState(false);
  const title = itemTitle(item, locale, templates, tc(`item.${itemKind(item)}`));
  const photo = item.image;
  const photoSrc = photo ? mediaUrl(photo.key, 1440) : null;
  const eventAt = item.announcement?.eventAt;
  const isAnnouncement = item.type === 'announcement';
  return (
    <Screen
      title={isAnnouncement ? t('announcements') : tc(`item.${itemKind(item)}`)}
      {...(name ? { subtitle: name } : {})}
    >
      <article className="flex flex-col gap-4 pt-2 pb-6">
        <header className="flex items-start gap-3">
          <ItemIcon item={item} size={56} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 dir="auto" className="type-title2 text-text">
              {title}
            </h2>
            <p className="type-footnote text-text-secondary">
              {name ? (
                <>
                  <bdi>{name}</bdi>
                  {' · '}
                </>
              ) : null}
              {format.relative(new Date(item.publishedAt), now)}
              {item.editedAt ? ` · ${t('edited')}` : ''}
            </p>
          </div>
        </header>
        {isAnnouncement ? (
          <div className="flex flex-wrap gap-2">
            {announcementTags(item).map((tag) => (
              <Tag key={tag} tone={TAG_TONE[tag]}>
                {t(`tag.${tag}`)}
              </Tag>
            ))}
          </div>
        ) : null}
        {body ? (
          <p dir="auto" className="type-body whitespace-pre-line text-text">
            {body}
          </p>
        ) : null}
        {photo ? (
          <>
            <Pressable
              kind="card"
              aria-label={t('openPhoto')}
              onPress={() => {
                setViewing(true);
              }}
              className="block w-full overflow-hidden rounded-lg"
            >
              <Image src={photoSrc} alt={t('photoAlt')} thumbhash={photo.thumbhash} ratio="16/10" />
            </Pressable>
            <ImageViewer
              open={viewing}
              onClose={() => {
                setViewing(false);
              }}
              src={photoSrc}
              thumbhash={photo.thumbhash}
              alt={t('photoAlt')}
              closeLabel={t('closePhoto')}
            />
          </>
        ) : null}
        {eventAt ? (
          <Card variant="mint" className="flex flex-col gap-3">
            <p className="flex items-center gap-2 type-subhead-strong text-primary-800">
              <CalendarIcon size={20} />
              {t('eventDate', { date: eventLabel(eventAt, format) })}
            </p>
            <Button
              variant="outline"
              leadingIcon={<DownloadIcon />}
              onPress={() => {
                downloadFile(
                  eventFile({
                    publicId: item.publicId,
                    start: new Date(eventAt),
                    title,
                    body,
                    masjid: name,
                    origin: window.location.origin,
                    now: correctedNow(),
                  }),
                );
              }}
            >
              {t('addToCalendar')}
            </Button>
          </Card>
        ) : null}
        <ShareButton item={item} masjid={masjid} />
        <LandingFooter />
      </article>
    </Screen>
  );
}

/** Read Full (07 A8). */
function Reader({ item, masjid }: DetailProps) {
  const { t } = useTranslation('content');
  const { locale, format } = useLocale();
  const { store } = useAppData();
  const toast = useToast();
  const name = useMasjidLabel(masjid);
  const scale = useDeviceSelector((state) => state.settings.arabicScale);
  const showTransliteration = useDeviceSelector((state) => state.settings.transliteration);
  const saved = useSaved({ saved: t('savedToast'), removed: t('removedToast') });
  const { readOnly } = use(DetailModeContext);
  const library = item.daily?.library;
  if (!library) return null;
  const text = libraryText(library, locale);
  const isSaved = saved.isSaved(item.publicId);
  const setScale = (next: number) => {
    const value = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, next)) * 10) / 10;
    void store.update((current) => ({ ...current, settings: { ...current.settings, arabicScale: value } }));
  };
  return (
    <Screen
      title={t('hadithQuran')}
      {...(name ? { subtitle: name } : {})}
      actions={
        readOnly ? undefined : (
          <IconButton
            label={isSaved ? t('saved') : t('save')}
            aria-pressed={isSaved}
            icon={<BookmarkIcon filled={isSaved} />}
            className={isSaved ? 'text-primary-700' : undefined}
            onPress={() => {
              saved.toggle(item, masjid);
            }}
          />
        )
      }
    >
      <article className="flex flex-col gap-5 pt-2 pb-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2" role="group" aria-label={t('hadithQuran')}>
            <Button
              variant="secondary"
              aria-label={t('smaller')}
              disabled={scale <= SCALE_MIN}
              onPress={() => {
                setScale(scale - SCALE_STEP);
              }}
            >
              <span aria-hidden>A−</span>
            </Button>
            <Button
              variant="secondary"
              aria-label={t('larger')}
              disabled={scale >= SCALE_MAX}
              onPress={() => {
                setScale(scale + SCALE_STEP);
              }}
            >
              <span aria-hidden>A+</span>
            </Button>
          </div>
          <span className="type-caption text-text-tertiary">{format.date(new Date(item.publishedAt), 'medium')}</span>
        </div>
        <Card className="flex flex-col gap-4 text-center">
          <ArabicText variant="hero" scale={scale}>
            {library.arabic}
          </ArabicText>
          {showTransliteration && text.transliteration ? (
            <p dir="auto" className="type-callout text-text-secondary">
              {text.transliteration}
            </p>
          ) : null}
          <p className={`type-body text-text ${locale === 'en' || text.fallback ? 'italic' : ''}`}>
            {t('quoted', { text: text.translation })}
            {text.fallback ? (
              <Tag tone="neutral" className="ms-2 align-middle not-italic">
                {t('english')}
              </Tag>
            ) : null}
          </p>
          <p className="type-footnote text-text-secondary">
            <bdi>{library.reference}</bdi>
          </p>
          {item.daily?.note ? (
            <figure className="rounded-sm bg-mint-50 p-3 text-start">
              <figcaption className="type-caption font-semibold text-primary-700">{t('noteFromMasjid')}</figcaption>
              <blockquote dir="auto" className="mt-1 type-footnote text-text">
                {item.daily.note}
              </blockquote>
            </figure>
          ) : null}
        </Card>
        {text.transliteration ? (
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
        <p className="type-caption text-text-tertiary">
          {t('source', { name: library.sourceName })} · {t('license', { license: library.sourceLicense })}
        </p>
        <div className="flex flex-col gap-3">
          <Button
            variant="secondary"
            fullWidth
            leadingIcon={<CopyIcon />}
            onPress={() => {
              const copied = [library.arabic, text.translation, library.reference].join('\n\n');
              void navigator.clipboard
                .writeText(copied)
                .then(() => {
                  toast.show({ message: t('copied'), tone: 'success' });
                })
                .catch(() => undefined);
            }}
          >
            {t('copy')}
          </Button>
          <ShareButton item={item} masjid={masjid} />
        </div>
        <LandingFooter />
      </article>
    </Screen>
  );
}

/** Dua detail (07 A9). */
function DuaDetail({ item, masjid }: DetailProps) {
  const { t } = useTranslation('content');
  const { t: tc } = useTranslation();
  const { locale, format } = useLocale();
  const now = useNow();
  const name = useMasjidLabel(masjid);
  const ameen = useAmeen([item.publicId]);
  const { readOnly } = use(DetailModeContext);
  const dua = item.dua;
  if (!dua) return null;
  const person = duaPerson(item);
  const text = dua.library ? libraryText(dua.library, locale) : null;
  const count = ameen.count(item.publicId);
  const when = dua.janazaAt ? janazaWhen(dua.janazaAt, now, format, tc('home.today')) : undefined;
  return (
    <Screen title={t('duaRequests')} {...(name ? { subtitle: name } : {})}>
      <article className="flex flex-col gap-4 pt-2 pb-6">
        <header className="flex items-start gap-3">
          <ItemIcon item={item} size={56} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <Tag tone={DUA_TAG_TONE[dua.category]}>{t(`tag.${dua.category}`)}</Tag>
              <span className="type-caption text-text-tertiary">
                {format.relative(new Date(item.publishedAt), now)}
              </span>
            </span>
            <h2 className="type-title2 text-text">{t('requestForDua')}</h2>
          </div>
        </header>
        {person ? (
          <p className="type-subhead-strong text-text">
            {person.kind === 'named' ? t('forPerson', { name: person.name }) : t('forPrivate')}
          </p>
        ) : null}
        {item.body ? (
          <p dir="auto" className="type-body whitespace-pre-line text-text">
            {item.body}
          </p>
        ) : null}
        {dua.library && text ? (
          <DuaBox
            size="lg"
            arabic={dua.library.arabic}
            transliteration={text.transliteration}
            translation={text.translation}
            translationTag={text.fallback ? t('english') : undefined}
          />
        ) : null}
        {dua.category === 'inteqal' && when ? (
          <p className="flex items-center gap-2 type-callout text-slate">
            <ClockIcon size={20} />
            {dua.janazaPlace ? t('janaza', { when, place: dua.janazaPlace }) : t('janazaTime', { when })}
          </p>
        ) : null}
        {readOnly ? (
          count === undefined ? null : (
            <p className="text-center type-callout text-text-secondary">{t('ameenCount', { count })}</p>
          )
        ) : (
          <div className="flex justify-center py-2">
            <AmeenButton
              size="lg"
              said={ameen.said(item.publicId)}
              onSay={() => {
                ameen.say(item.publicId);
              }}
              label={t('ameen')}
              saidLabel={t('ameenSaid')}
              count={count === undefined ? undefined : t('ameenCount', { count })}
            />
          </div>
        )}
        <ShareButton item={item} masjid={masjid} />
        <LandingFooter />
      </article>
    </Screen>
  );
}
