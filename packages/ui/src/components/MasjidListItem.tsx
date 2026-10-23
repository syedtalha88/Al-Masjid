// MasjidListItem (06 §6 Content, ref-1/2 My Masjids): 3:4 photo thumb (or the green tile), name, area, "Next Prayer"
// with the prayer icon, name and countdown; trailing chevron and a green "N new updates" circle. `highlighted` tints the
// card mint (07 A3: the masjid with the soonest jamaat).
import type { Countdown } from '@mc/domain/countdown';
import { useTranslation } from '@mc/i18n/react';

import { CaretRightIcon } from '../icons/glyphs.tsx';
import { MasjidTile } from '../icons/MasjidTile.tsx';
import { PrayerIcon } from '../icons/PrayerIcon.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { Image } from './Image.tsx';
import { CountdownText, type PrayerSlotName, usePrayerName } from './Prayer.tsx';

export interface MasjidListItemProps {
  readonly name: string;
  readonly place: string;
  readonly photo?: { readonly src: string; readonly thumbhash?: string | undefined } | null;
  /** The next jamaat, or `null` (then `emptyText` shows). */
  readonly prayer: PrayerSlotName | null;
  readonly countdown: Countdown | null;
  readonly emptyText?: string;
  /** Items not seen yet (0 hides the circle). */
  readonly unseen: number;
  readonly highlighted?: boolean;
  readonly onPress: () => void;
  readonly onLongPress?: () => void;
}

export function MasjidListItem({
  name,
  place,
  photo,
  prayer,
  countdown,
  emptyText,
  unseen,
  highlighted = false,
  onPress,
  onLongPress,
}: MasjidListItemProps) {
  const { t } = useTranslation();
  const prayerName = usePrayerName();
  return (
    <Pressable
      kind="card"
      onPress={onPress}
      {...(onLongPress ? { onLongPress } : {})}
      className={`flex w-full gap-3 rounded-lg p-3 text-start transition-state ${
        highlighted ? 'bg-mint-50' : 'bg-surface shadow-e1'
      }`}
    >
      {photo ? (
        <Image
          src={photo.src}
          alt=""
          ratio="3/4"
          rounded="rounded-lg"
          className="w-18 shrink-0"
          {...(photo.thumbhash ? { thumbhash: photo.thumbhash } : {})}
        />
      ) : (
        <span className="flex aspect-[3/4] w-18 shrink-0 items-center justify-center rounded-lg bg-mint-50">
          <MasjidTile size="md" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-start gap-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate type-headline text-text">{name}</span>
            <span className="truncate type-footnote text-text-secondary">{place}</span>
          </span>
          <CaretRightIcon size={20} className="mt-0.5 shrink-0 text-text-secondary rtl:-scale-x-100" />
        </span>
        <span className="mt-auto flex items-end gap-2 pt-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="type-caption text-text-secondary">{t('ui.nextPrayer')}</span>
            {prayer ? (
              <span className="flex flex-wrap items-center gap-x-1.5">
                <PrayerIcon prayer={prayer === 'jumuah' ? 'dhuhr' : prayer} size={18} className="text-sun" />
                <span className="type-subhead-strong text-text">{prayerName(prayer)}</span>
                {countdown ? <CountdownText value={countdown} /> : null}
              </span>
            ) : (
              <span className="type-footnote text-text-secondary">{emptyText}</span>
            )}
          </span>
          {unseen > 0 ? (
            <span className="flex shrink-0 items-center gap-1.5" data-unseen={unseen}>
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary-700 type-caption text-on-primary tabular-nums">
                {unseen > 9 ? '9+' : String(unseen)}
              </span>
              <span className="max-w-16 type-micro leading-tight text-text-secondary">
                {t('ui.newUpdatesShort', { count: unseen })}
              </span>
            </span>
          ) : null}
        </span>
      </span>
    </Pressable>
  );
}
