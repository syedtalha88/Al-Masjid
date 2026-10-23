// A5 Masjid Detail (07 A5, ref-1/3, 08 §4 hero parallax): full-bleed hero (ThumbHash → photo) under a scrim with back and
// "…" over it; an overlapping sheet with name + Verified, location, Notifications (per-masjid mute, stored on the server)
// / Share / Directions; tabs Overview · Prayer Timings · Announcements (swipeable). Overview: next jamaat, today's strip,
// Ramadan card, section rows with unseen counts (only sections with content). Scrolling moves the hero at 0.4× and grows
// it on overscroll; the bar turns solid with the masjid name once the hero is ~80% gone. Suspended → greyed hero +
// message + Unfollow.
import { useLocale, useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import type { ActiveMasjidBundle } from '@mc/shared/contracts/public';
import {
  Button,
  CircleAction,
  CountBadge,
  Dialog,
  EmptyState,
  IconButton,
  IconCircle,
  Image,
  ListRow,
  NextPrayerPanel,
  PrayerStrip,
  Sheet,
  Skeleton,
  SkeletonText,
  TabPanels,
  type Tone,
  UnderlineTabs,
  useToast,
  VerifiedBadge,
} from '@mc/ui/components';
import {
  BellIcon,
  BellSlashIcon,
  BookOpenIcon,
  ChartBarIcon,
  DotsIcon,
  HandsPrayingIcon,
  HeartIcon,
  MapPinIcon,
  MasjidTile,
  MegaphoneIcon,
  PlayCircleIcon,
  ShareIcon,
} from '@mc/ui/icons';
import { useMotionPrefs } from '@mc/ui/motion';
import { BackIcon, useNavigator, useScreen } from '@mc/ui/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { useNow } from '../../lib/clock.ts';
import { useAppData, useDeviceState } from '../../lib/data.tsx';
import { masjidName, masjidPlace } from '../../lib/masjid.ts';
import { mediaUrl } from '../../lib/media.ts';
import { ItemList } from '../content/ItemList.tsx';
import { RamadanCard } from '../home/components/SeasonCards.tsx';
import { prayerView, ramadanView } from '../home/lib/home-view.ts';
import { shareNatively, ShareSheet, type ShareTarget } from './components/ShareSheet.tsx';
import { TimingsPanel } from './components/TimingsPanel.tsx';
import { useMasjidDetail } from './hooks/useMasjidDetail.ts';
import { directionsLink, followLink, type SectionId, sectionRows } from './lib/detail-view.ts';

type TabId = 'overview' | 'timings' | 'announcements';

/** Hero parallax (08 §4): the hero moves at this fraction of the scroll and grows up to 1.15 on overscroll. */
const PARALLAX = 0.4;
const MAX_OVERSCROLL_SCALE = 1.15;

const SECTION_ICON: Readonly<Record<SectionId, { readonly icon: ReactNode; readonly tone: Tone }>> = {
  announcements: { icon: <MegaphoneIcon />, tone: 'info' },
  hadith: { icon: <BookOpenIcon />, tone: 'info' },
  duas: { icon: <HandsPrayingIcon />, tone: 'primary' },
  campaigns: { icon: <HeartIcon />, tone: 'heart' },
  chanda: { icon: <ChartBarIcon />, tone: 'purple' },
  bayans: { icon: <PlayCircleIcon />, tone: 'primary' },
};

export function MasjidDetailScreen() {
  // The namespace loads with this chunk; never show raw keys.
  const { ready } = useTranslation('masjid');
  const { params } = useScreen();
  const masjidId = params['masjidId'] ?? '';
  if (!ready) return <DetailSkeleton />;
  return <Detail masjidId={masjidId} />;
}

function Detail({ masjidId }: { readonly masjidId: string }) {
  const { t } = useTranslation('masjid');
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  const navigator = useNavigator();
  const toast = useToast();
  const now = useNow();
  const { reduced } = useMotionPrefs();
  const { store, sync } = useAppData();
  const device = useDeviceState();
  const detail = useMasjidDetail(masjidId);
  const [tab, setTab] = useState<TabId>('overview');
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const barTitle = useRef<HTMLParagraphElement>(null);

  const bundle = detail.masjid.state === 'active' ? detail.masjid.bundle : null;
  const name = bundle ? masjidName(bundle.masjid, locale) : '';
  const muted = detail.follow?.muted ?? false;

  // Hero parallax + solid bar (08 §4): one rAF-batched write per scroll frame, transforms/opacity only.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const y = node.scrollTop;
      const height = hero.current?.offsetHeight ?? 1;
      if (hero.current && !reduced) {
        hero.current.style.transform =
          y >= 0
            ? `translateY(${String(y * PARALLAX)}px)`
            : `scale(${String(Math.min(1 + -y / height, MAX_OVERSCROLL_SCALE))})`;
      }
      const solid = Math.min(Math.max((y - height * 0.6) / (height * 0.2), 0), 1);
      if (bar.current) bar.current.style.opacity = String(solid);
      if (barTitle.current) barTitle.current.style.opacity = String(solid);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', onScroll);
    };
  }, [reduced, detail.masjid.state]);

  const onShare = async () => {
    if (!bundle) return;
    const target = { name, url: followLink(window.location.origin, bundle.masjid.followCode) };
    if (!(await shareNatively(target, t('shareText', { name, app: BRAND.name })))) setShare(target);
  };

  const toggleMute = async () => {
    const module = await import('../../lib/device/sync.ts');
    try {
      await module.setMuted(sync, masjidId, !muted);
      toast.show({ message: !muted ? t('mutedToast') : t('unmutedToast') });
    } catch {
      toast.show({ message: t('muteFailed'), tone: 'error' });
    }
  };

  const unfollow = async () => {
    const module = await import('../../lib/device/sync.ts');
    await module.unfollowLocally(store, masjidId);
    void module.syncFollows(sync).catch(() => undefined);
    toast.show({ message: tc('masjids.unfollowed', { name: name || t('suspended') }) });
    navigator.back();
  };

  const tabs = [
    { id: 'overview' as const, label: t('overview') },
    { id: 'timings' as const, label: t('timings') },
    { id: 'announcements' as const, label: t('announcements') },
  ];

  const photo = bundle?.masjid.photo ? mediaUrl(bundle.masjid.photo.key, 960) : null;

  return (
    <div className="relative h-full bg-bg">
      {/* Bar: transparent over the hero, solid with the name once the hero has scrolled away. */}
      <header className="absolute inset-x-0 top-0 z-20 pt-safe">
        <div ref={bar} aria-hidden className="absolute inset-0 border-b border-border bg-bg opacity-0" />
        <div className="relative flex min-h-14 items-center justify-between gap-2 px-screen">
          <IconButton
            label={tc('nav.back')}
            variant="onImage"
            icon={<BackIcon className="rtl:-scale-x-100" />}
            onPress={() => {
              navigator.back();
            }}
          />
          <p ref={barTitle} aria-hidden className="min-w-0 truncate type-headline text-text opacity-0">
            {name}
          </p>
          {detail.masjid.state === 'active' || detail.follow ? (
            <IconButton
              label={t('more')}
              variant="onImage"
              icon={<DotsIcon />}
              onPress={() => {
                setMenu(true);
              }}
            />
          ) : (
            <span className="size-(--mc-hit)" />
          )}
        </div>
      </header>

      <div ref={scroller} data-screen-scroll className="scroller h-full pb-[var(--mc-tabbar-h,0px)]">
        <div className="relative overflow-hidden">
          <div ref={hero} className="origin-bottom">
            {photo && bundle?.masjid.photo ? (
              <Image
                src={photo}
                alt=""
                ratio="16/10"
                rounded="rounded-none"
                priority
                {...(bundle.masjid.photo.thumbhash ? { thumbhash: bundle.masjid.photo.thumbhash } : {})}
                className={detail.masjid.state === 'suspended' ? 'grayscale' : ''}
              />
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center bg-mint-100">
                {detail.masjid.state === 'loading' ? null : <MasjidTile />}
              </div>
            )}
          </div>
          {/* Top scrim keeps the overlay buttons readable on bright photos. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-overlay to-transparent"
          />
        </div>

        <div className="relative -mt-6 min-h-dvh rounded-t-xl bg-bg px-screen pt-5 pb-8">
          {detail.masjid.state === 'active' && bundle ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h1 data-screen-title tabIndex={-1} className="type-title1 text-text outline-none">
                  {name}
                </h1>
                {bundle.masjid.verified ? <VerifiedBadge /> : null}
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 type-callout text-text-secondary">
                <MapPinIcon size={18} className="shrink-0" />
                <span>{[masjidPlace(bundle.masjid), bundle.masjid.state].filter(Boolean).join(', ')}</span>
              </p>
              <div className="mt-4 flex justify-center gap-8">
                {detail.follow ? (
                  <CircleAction
                    icon={muted ? <BellSlashIcon /> : <BellIcon />}
                    label={t('notifications')}
                    aria-pressed={!muted}
                    onPress={() => void toggleMute()}
                  />
                ) : null}
                <CircleAction icon={<ShareIcon />} label={t('share')} onPress={() => void onShare()} />
                <CircleAction
                  icon={<MapPinIcon />}
                  label={t('directions')}
                  onPress={() => {
                    window.open(directionsLink(bundle.masjid.lat, bundle.masjid.lng), '_blank', 'noopener,noreferrer');
                  }}
                />
              </div>
              <UnderlineTabs
                className="mt-5"
                label={t('tabsLabel')}
                idPrefix="masjid-tab"
                tabs={tabs}
                value={tab}
                onChange={setTab}
              />
              <TabPanels className="pt-4" idPrefix="masjid-tab" tabs={tabs} value={tab} onChange={setTab}>
                {(id) =>
                  id === 'overview' ? (
                    <Overview
                      bundle={bundle}
                      now={now}
                      detail={detail}
                      seenAt={device.updatesSeenAt}
                      onTimings={() => {
                        setTab('timings');
                      }}
                    />
                  ) : id === 'timings' ? (
                    <TimingsPanel bundle={bundle} now={now} />
                  ) : (
                    <ItemList
                      items={detail.pages.get('announcement') ?? []}
                      loading={!detail.pages.has('announcement')}
                      now={now}
                      emptyText={t('noAnnouncements')}
                    />
                  )
                }
              </TabPanels>
            </>
          ) : detail.masjid.state === 'loading' ? (
            <div aria-busy className="flex flex-col gap-3">
              <Skeleton className="h-7 w-2/3 rounded-xs" />
              <SkeletonText lines={2} />
            </div>
          ) : (
            <EmptyState
              className="pt-6"
              title={
                detail.masjid.state === 'suspended'
                  ? t('suspended')
                  : detail.masjid.state === 'gone'
                    ? t('gone')
                    : tc('appError.title')
              }
              {...(detail.masjid.state === 'failed' ? { body: tc('appError.body') } : {})}
              action={
                detail.masjid.state === 'failed' ? (
                  <Button size="lg" onPress={detail.retry}>
                    {tc('appError.retry')}
                  </Button>
                ) : detail.follow ? (
                  <Button
                    size="lg"
                    variant="danger"
                    onPress={() => {
                      setConfirm(true);
                    }}
                  >
                    {tc('masjids.unfollow')}
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      </div>

      <Sheet
        open={menu}
        onClose={() => {
          setMenu(false);
        }}
        title={name || t('more')}
      >
        <div className="flex flex-col gap-2 pb-2">
          {bundle ? (
            <Button
              variant="secondary"
              fullWidth
              leadingIcon={<ShareIcon />}
              onPress={() => {
                setMenu(false);
                void onShare();
              }}
            >
              {t('share')}
            </Button>
          ) : null}
          {detail.follow && bundle ? (
            <Button
              variant="secondary"
              fullWidth
              leadingIcon={muted ? <BellIcon /> : <BellSlashIcon />}
              onPress={() => {
                setMenu(false);
                void toggleMute();
              }}
            >
              {muted ? t('unmute') : t('mute')}
            </Button>
          ) : null}
          {detail.follow ? (
            <Button
              variant="danger"
              fullWidth
              onPress={() => {
                setMenu(false);
                setConfirm(true);
              }}
            >
              {tc('masjids.unfollow')}
            </Button>
          ) : null}
        </div>
      </Sheet>

      <Dialog
        open={confirm}
        onClose={() => {
          setConfirm(false);
        }}
        title={tc('masjids.unfollowTitle', { name: name || t('suspended') })}
        body={tc('masjids.unfollowBody')}
        confirmLabel={tc('masjids.unfollow')}
        cancelLabel={tc('ui.cancel')}
        destructive
        onConfirm={() => {
          setConfirm(false);
          void unfollow();
        }}
      />
      <ShareSheet
        target={share}
        onClose={() => {
          setShare(null);
        }}
      />
    </div>
  );
}

function Overview({
  bundle,
  now,
  detail,
  seenAt,
  onTimings,
}: {
  readonly bundle: ActiveMasjidBundle;
  readonly now: Date;
  readonly detail: ReturnType<typeof useMasjidDetail>;
  readonly seenAt: string | undefined;
  readonly onTimings: () => void;
}) {
  const { t } = useTranslation('masjid');
  const { t: tc } = useTranslation();
  const { format } = useLocale();
  const navigator = useNavigator();
  const view = useMemo(() => prayerView(bundle, now), [bundle, now]);
  const ramadan = useMemo(() => ramadanView([bundle], now), [bundle, now]);
  const rows = sectionRows(bundle, detail.pages, seenAt, detail.follow?.followedAt ?? null);
  return (
    <div className="flex flex-col gap-4">
      {view ? (
        <>
          <NextPrayerPanel
            prayer={view.next?.prayer ?? null}
            countdown={view.next?.countdown ?? null}
            emptyText={tc('home.noJamaat')}
            onPress={onTimings}
          />
          <PrayerStrip
            slots={view.slots}
            activeIndex={view.activeIndex}
            label={tc('home.strip', { date: format.calendarDate(view.date, 'long') })}
          />
        </>
      ) : (
        <p className="type-callout text-text-secondary">{tc('home.noTimings')}</p>
      )}
      {ramadan ? <RamadanCard view={ramadan} masjid={undefined} /> : null}
      {rows.length > 0 ? (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.id}>
              <ListRow
                leading={
                  <IconCircle tone={SECTION_ICON[row.id].tone} size={44}>
                    {SECTION_ICON[row.id].icon}
                  </IconCircle>
                }
                title={t(row.id)}
                trailing={row.unseen > 0 ? <CountBadge count={row.unseen} /> : undefined}
                chevron
                onPress={() => {
                  navigator.push(`/masjid/${bundle.masjid.id}/${row.id}`);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy className="h-full bg-bg">
      <Skeleton className="aspect-[16/10] w-full rounded-none" />
      <div className="flex flex-col gap-3 px-screen pt-5">
        <Skeleton className="h-7 w-2/3 rounded-xs" />
        <SkeletonText lines={2} />
      </div>
    </div>
  );
}
