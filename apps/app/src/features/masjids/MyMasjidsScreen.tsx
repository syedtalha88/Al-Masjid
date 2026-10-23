// A3 My Masjids (07 A3, ref-1/2): followed masjids in the user's order — 3:4 thumb, next jamaat with countdown, "N new
// updates" — the soonest jamaat tinted mint; "+ Add Masjid" (Scan / Enter code); Edit (or long-press) → reorder mode:
// drag handles, tap a masjid for Move up / Move down / Unfollow; unfollow asks first and offers Undo. The order is kept
// on this device; follows sync with the server in the background (offline: queued).
import { useLocale, useTranslation } from '@mc/i18n/react';
import { QrPosterIllustration } from '@mc/ui';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  InfoNote,
  MasjidListItem,
  ReorderList,
  Sheet,
  Skeleton,
  SkeletonText,
  useToast,
} from '@mc/ui/components';
import { KeyboardIcon, MinusIcon, PlusIcon } from '@mc/ui/icons';
import { haptic } from '@mc/ui/motion';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { memo, useCallback, useMemo, useState } from 'react';

import { useNow } from '../../lib/clock.ts';
import { useAppData, useDeviceSelector } from '../../lib/data.tsx';
import { MAX_FOLLOWS, visibleFollows } from '../../lib/device/store.ts';
import { masjidName, masjidPlace } from '../../lib/masjid.ts';
import { mediaUrl } from '../../lib/media.ts';
import { type HomeMasjid, useHomeData } from '../home/hooks/useHomeData.ts';
import { prayerView } from '../home/lib/home-view.ts';
import { moveItem, soonestIndex, unseenCount } from './lib/masjids-view.ts';

const UNDO_TOAST_MS = 5000;

export function MyMasjidsScreen() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigator = useNavigator();
  const toast = useToast();
  const now = useNow();
  const { store, sync } = useAppData();
  const deviceFollows = useDeviceSelector((state) => state.follows);
  const updatesSeenAt = useDeviceSelector((state) => state.updatesSeenAt);
  const data = useHomeData();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const enterEditing = useCallback(() => {
    haptic('impactLight');
    setEditing(true);
  }, []);

  const follows = useMemo(() => visibleFollows(deviceFollows), [deviceFollows]);
  const followedAt = useMemo(() => new Map(follows.map((follow) => [follow.masjidId, follow.followedAt])), [follows]);
  const views = useMemo(
    () => data.masjids.map((masjid) => (masjid.state === 'active' ? prayerView(masjid.bundle, now) : null)),
    [data.masjids, now],
  );
  const soonest = soonestIndex(views.map((view) => view?.next?.at.getTime() ?? null));
  const ids = data.masjids.map((masjid) => masjid.id);
  const atLimit = follows.length >= MAX_FOLLOWS;

  const nameOf = (masjid: HomeMasjid | undefined) =>
    masjid?.state === 'active' ? masjidName(masjid.bundle.masjid, locale) : t('home.suspended');
  const byId = (id: string | null) => data.masjids.find((masjid) => masjid.id === id);

  const reorder = async (from: number, to: number) => {
    const sync = await import('../../lib/device/sync.ts');
    await sync.reorderFollows(store, moveItem(ids, from, to));
  };

  const unfollow = async (id: string) => {
    const module = await import('../../lib/device/sync.ts');
    const index = follows.findIndex((follow) => follow.masjidId === id);
    const original = follows[index];
    const name = nameOf(byId(id));
    if (!original) return;
    await module.unfollowLocally(store, id);
    void module.syncFollows(sync).catch(() => undefined);
    toast.show({
      message: t('masjids.unfollowed', { name }),
      duration: UNDO_TOAST_MS,
      action: {
        label: t('masjids.undo'),
        onPress: () => {
          void module
            .restoreFollow(store, original, index)
            .then(() => module.syncFollows(sync))
            .catch(() => undefined);
        },
      },
    });
  };

  const addButtons = (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        fullWidth
        onPress={() => {
          setAdding(false);
          navigator.presentModal('/scan');
        }}
      >
        {t('home.emptyScan')}
      </Button>
      <Button
        size="lg"
        variant="secondary"
        fullWidth
        leadingIcon={<KeyboardIcon />}
        onPress={() => {
          setAdding(false);
          navigator.presentModal('/scan?enter=code');
        }}
      >
        {t('home.emptyCode')}
      </Button>
    </div>
  );

  const menuIndex = menuFor === null ? -1 : ids.indexOf(menuFor);

  return (
    <Screen
      variant="large"
      title={t('tabs.myMasjids')}
      actions={
        data.empty ? null : (
          <>
            <Button
              variant="ghost"
              onPress={() => {
                setEditing(!editing);
              }}
            >
              {editing ? t('masjids.done') : t('masjids.edit')}
            </Button>
            {editing || atLimit ? null : (
              <Button
                leadingIcon={<PlusIcon />}
                className="whitespace-nowrap"
                onPress={() => {
                  setAdding(true);
                }}
              >
                {t('masjids.add')}
              </Button>
            )}
          </>
        )
      }
    >
      {data.empty ? (
        <EmptyState
          className="pt-8"
          illustration={<QrPosterIllustration width={180} />}
          title={t('home.emptyTitle')}
          body={t('home.emptyBody')}
          action={<div className="w-full max-w-xs">{addButtons}</div>}
        />
      ) : (
        <div className="flex flex-col gap-4 pb-6">
          {editing ? (
            <>
              <p className="type-footnote text-text-secondary">{t('masjids.editHint')}</p>
              <ReorderList
                label={t('tabs.myMasjids')}
                items={data.masjids}
                keyOf={(masjid) => masjid.id}
                handleLabel={(masjid) => t('masjids.reorder', { name: nameOf(masjid) })}
                onReorder={(from, to) => void reorder(from, to)}
                renderItem={(masjid) => (
                  <div className="flex items-center gap-2 rounded-lg bg-surface p-2 shadow-e1">
                    <IconButton
                      label={`${t('masjids.unfollow')}: ${nameOf(masjid)}`}
                      icon={<MinusIcon className="text-on-primary" />}
                      className="[&>span]:bg-danger"
                      onPress={() => {
                        setConfirmFor(masjid.id);
                      }}
                    />
                    <button
                      type="button"
                      className="flex min-h-(--mc-hit) min-w-0 flex-1 flex-col justify-center text-start"
                      onClick={() => {
                        setMenuFor(masjid.id);
                      }}
                    >
                      <span className="truncate type-headline text-text">{nameOf(masjid)}</span>
                      {masjid.state === 'active' ? (
                        <span className="truncate type-footnote text-text-secondary">
                          {masjidPlace(masjid.bundle.masjid)}
                        </span>
                      ) : null}
                    </button>
                  </div>
                )}
              />
            </>
          ) : (
            <ul aria-label={t('tabs.myMasjids')} className="flex flex-col gap-3">
              {data.masjids.map((masjid, index) => (
                <li key={masjid.id}>
                  <Row
                    masjid={masjid}
                    view={views[index] ?? null}
                    highlighted={index === soonest}
                    unseen={unseenCount(
                      data.itemsByMasjid.get(masjid.id) ?? [],
                      updatesSeenAt,
                      followedAt.get(masjid.id) ?? '',
                    )}
                    onLongPress={enterEditing}
                  />
                </li>
              ))}
            </ul>
          )}
          {atLimit ? (
            <InfoNote>{t('masjids.limit', { max: MAX_FOLLOWS })}</InfoNote>
          ) : editing ? null : (
            <Button
              size="lg"
              variant="outline"
              fullWidth
              leadingIcon={<PlusIcon />}
              onPress={() => {
                setAdding(true);
              }}
            >
              {t('masjids.addAnother')}
            </Button>
          )}
        </div>
      )}

      <Sheet
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        title={t('masjids.addTitle')}
      >
        <div className="pb-2">{addButtons}</div>
      </Sheet>

      <Sheet
        open={menuFor !== null}
        onClose={() => {
          setMenuFor(null);
        }}
        title={nameOf(byId(menuFor))}
      >
        <div className="flex flex-col gap-2 pb-2">
          <Button
            variant="secondary"
            fullWidth
            disabled={menuIndex <= 0}
            onPress={() => {
              void reorder(menuIndex, menuIndex - 1);
              setMenuFor(null);
            }}
          >
            {t('masjids.moveUp')}
          </Button>
          <Button
            variant="secondary"
            fullWidth
            disabled={menuIndex < 0 || menuIndex >= ids.length - 1}
            onPress={() => {
              void reorder(menuIndex, menuIndex + 1);
              setMenuFor(null);
            }}
          >
            {t('masjids.moveDown')}
          </Button>
          <Button
            variant="danger"
            fullWidth
            onPress={() => {
              setConfirmFor(menuFor);
              setMenuFor(null);
            }}
          >
            {t('masjids.unfollow')}
          </Button>
        </div>
      </Sheet>

      <Dialog
        open={confirmFor !== null}
        onClose={() => {
          setConfirmFor(null);
        }}
        title={t('masjids.unfollowTitle', { name: nameOf(byId(confirmFor)) })}
        body={t('masjids.unfollowBody')}
        confirmLabel={t('masjids.unfollow')}
        cancelLabel={t('ui.cancel')}
        destructive
        onConfirm={() => {
          const id = confirmFor;
          setConfirmFor(null);
          if (id) void unfollow(id);
        }}
      />
    </Screen>
  );
}

/** Memoised list row (see HomeMasjidCard). */
const Row = memo(function Row({
  masjid,
  view,
  highlighted,
  unseen,
  onLongPress,
}: {
  readonly masjid: HomeMasjid;
  readonly view: ReturnType<typeof prayerView>;
  readonly highlighted: boolean;
  readonly unseen: number;
  readonly onLongPress: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigator = useNavigator();
  if (masjid.state === 'loading') {
    return (
      <Card aria-busy className="flex gap-3 p-3">
        <Skeleton className="aspect-[3/4] w-18 rounded-lg" />
        <SkeletonText lines={3} className="flex-1 pt-1" />
      </Card>
    );
  }
  if (masjid.state !== 'active') {
    return (
      <Card className="p-4">
        <p className="type-callout text-text-secondary">
          {masjid.state === 'suspended' ? t('home.suspended') : t('home.loadFailed')}
        </p>
      </Card>
    );
  }
  const { masjid: profile } = masjid.bundle;
  const photo = profile.photo ? mediaUrl(profile.photo.key, 480) : null;
  return (
    <MasjidListItem
      name={masjidName(profile, locale)}
      place={masjidPlace(profile)}
      photo={profile.photo && photo ? { src: photo, thumbhash: profile.photo.thumbhash } : null}
      prayer={view?.next?.prayer ?? null}
      countdown={view?.next?.countdown ?? null}
      emptyText={view ? t('home.noJamaat') : t('home.noTimings')}
      unseen={unseen}
      highlighted={highlighted}
      onPress={() => {
        navigator.push(`/masjid/${profile.id}`);
      }}
      onLongPress={onLongPress}
    />
  );
});
