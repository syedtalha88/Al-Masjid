// Bayans (07 A12, DECISIONS #39, PHASE_06 T6.3): the list card and the YouTube facade. Both show OUR copy of the
// thumbnail; nothing is loaded from Google or YouTube until the viewer taps Play — then the facade swaps itself for the
// youtube-nocookie iframe (CSP `frame-src https://www.youtube-nocookie.com`, app origin only). Offline, Play is not
// offered: "Connect to the internet to watch".
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem } from '@mc/shared/contracts/public';
import { useState } from 'react';

import { Tag } from '../components/Badges.tsx';
import { Image } from '../components/Image.tsx';
import { PlayIcon } from '../icons/glyph/PlayIcon.tsx';
import { WifiOffIcon } from '../icons/glyph/WifiOffIcon.tsx';
import { Pressable } from '../motion/Pressable.tsx';

/** The round play glyph on a thumbnail (decorative — the button around it carries the name). */
function PlayGlyph({ size = 56 }: { readonly size?: number }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0 m-auto flex items-center justify-center rounded-full bg-overlay text-on-primary"
      style={{ width: size, height: size }}
    >
      <PlayIcon size={Math.round(size * 0.45)} />
    </span>
  );
}

export interface VideoCardProps {
  /** A `video` feed item. */
  readonly item: FeedItem;
  /** Our thumbnail copy on the media origin (`null` → the ThumbHash only). */
  readonly thumbSrc: string | null;
  readonly onPress: () => void;
}

/**
 * A12 list card: 16:9 thumbnail (radius 16) with the play glyph, title (2 lines), speaker · date, a small "YouTube"
 * text tag (no logo).
 */
export function VideoCard({ item, thumbSrc, onPress }: VideoCardProps) {
  const { t } = useTranslation();
  const { format } = useLocale();
  const video = item.video;
  return (
    <Pressable
      kind="card"
      onPress={onPress}
      className="flex w-full flex-col gap-2 text-start"
      data-video-card={item.publicId}
    >
      <span className="relative block w-full overflow-hidden rounded-md">
        <Image src={thumbSrc} alt="" thumbhash={video?.thumb.thumbhash} ratio="16/9" rounded="rounded-md" />
        <PlayGlyph />
      </span>
      <span dir="auto" className="line-clamp-2 type-headline text-text">
        {item.title ?? ''}
      </span>
      <span className="flex flex-wrap items-center gap-2 type-caption text-text-secondary">
        {video?.speaker ? (
          <>
            <bdi dir="auto">{video.speaker}</bdi>
            <span aria-hidden>·</span>
          </>
        ) : null}
        <span>{format.date(new Date(item.publishedAt), 'medium')}</span>
        <Tag tone="neutral">{t('ui.video.youtube')}</Tag>
      </span>
    </Pressable>
  );
}

export interface YouTubeFacadeProps {
  /** The bayan's title: the Play button's name and the iframe's title. */
  readonly title: string;
  readonly thumbSrc: string | null;
  readonly thumbhash?: string | undefined;
  /** `youTubeEmbedUrl(id, start)` — built by the app from the stored id, never a pasted link. */
  readonly embedSrc: string;
  /** No connection: Play is not offered. */
  readonly offline: boolean;
}

/**
 * A12 player: our thumbnail + a big Play button + "Plays from YouTube"; on tap only, the youtube-nocookie iframe
 * (autoplay, YouTube's own controls, full screen allowed). 16:9, sticky at the top of the player screen.
 */
export function YouTubeFacade({ title, thumbSrc, thumbhash, embedSrc, offline }: YouTubeFacadeProps) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-surface-muted" data-video-player>
        <iframe
          src={embedSrc}
          title={title}
          className="absolute inset-0 size-full border-0"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-video-facade>
      <div className="relative w-full overflow-hidden rounded-md">
        <Image src={thumbSrc} alt="" thumbhash={thumbhash} ratio="16/9" rounded="rounded-md" priority />
        {offline ? (
          <p
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-overlay px-6 text-center type-subhead-strong text-on-primary"
            role="status"
            data-video-offline
          >
            <WifiOffIcon size={32} />
            {t('ui.video.offline')}
          </p>
        ) : (
          <button
            type="button"
            aria-label={t('ui.video.play', { title })}
            className="absolute inset-0 flex size-full items-center justify-center rounded-md"
            onClick={() => {
              setPlaying(true);
            }}
          >
            <PlayGlyph size={72} />
          </button>
        )}
      </div>
      <p className="type-caption text-text-secondary">{t('ui.video.playsFromYouTube')}</p>
    </div>
  );
}
