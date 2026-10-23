// The masjid preview shown before following (07 A4 preview sheet, A16 landing): photo (ThumbHash first), name in the
// app language, Verified badge, area and city. The follower count is never shown (07 A4).
import { useLocale } from '@mc/i18n/react';
import type { MasjidSummary } from '@mc/shared/contracts/public';
import { Image, VerifiedBadge } from '@mc/ui/components';
import { MapPinIcon, MasjidTile } from '@mc/ui/icons';

import { masjidName, masjidPlace } from '../../lib/masjid.ts';
import { mediaUrl } from '../../lib/media.ts';

export interface MasjidPreviewProps {
  readonly masjid: MasjidSummary;
  /** 1 on the landing screen (its title, focused after navigation), 3 inside a sheet (under the sheet title). */
  readonly headingLevel?: 1 | 3;
}

export function MasjidPreview({ masjid, headingLevel = 3 }: MasjidPreviewProps) {
  const { locale } = useLocale();
  const name = masjidName(masjid, locale);
  const photo = masjid.photo ? mediaUrl(masjid.photo.key, 960) : null;
  const Heading = headingLevel === 1 ? 'h1' : 'h3';
  return (
    <div className="flex flex-col gap-4">
      {masjid.photo && photo ? (
        <Image
          src={photo}
          alt=""
          ratio="16/10"
          priority
          {...(masjid.photo.thumbhash ? { thumbhash: masjid.photo.thumbhash } : {})}
        />
      ) : (
        <div className="flex aspect-[16/10] items-center justify-center rounded-lg bg-mint-50">
          <MasjidTile />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Heading
            {...(headingLevel === 1 ? { 'data-screen-title': true, tabIndex: -1 } : {})}
            className="type-title1 text-text outline-none"
          >
            {name}
          </Heading>
          {masjid.verified ? <VerifiedBadge /> : null}
        </div>
        <p className="flex items-center gap-1.5 type-callout text-text-secondary">
          <MapPinIcon size={18} className="shrink-0" />
          <span>{masjidPlace(masjid)}</span>
        </p>
      </div>
    </div>
  );
}
