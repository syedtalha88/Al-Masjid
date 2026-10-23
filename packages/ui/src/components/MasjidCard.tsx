// MasjidCard (06 §6 Content, ref-1 Home): the masjid row — photo thumb (56px, ThumbHash first) or the green tile, name,
// area, chevron — pressable to the masjid, with the prayer panel and strip below (passed as children).
import type { ReactNode } from 'react';

import { CaretRightIcon } from '../icons/glyphs.tsx';
import { MasjidTile } from '../icons/MasjidTile.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { Card } from './Card.tsx';
import { Image } from './Image.tsx';

export interface MasjidCardProps {
  readonly name: string;
  /** "Banjara Hills, Hyderabad". */
  readonly place: string;
  readonly photo?: { readonly src: string; readonly thumbhash?: string | undefined } | null;
  /** Opens the masjid (header row). */
  readonly onPress: () => void;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function MasjidCard({ name, place, photo, onPress, children, className }: MasjidCardProps) {
  return (
    <Card className={`flex flex-col gap-3 ${className ?? ''}`}>
      <Pressable kind="card" onPress={onPress} className="flex w-full items-center gap-3 text-start">
        {photo ? (
          <Image
            src={photo.src}
            alt=""
            ratio="1/1"
            rounded="rounded-md"
            className="size-14 shrink-0"
            {...(photo.thumbhash ? { thumbhash: photo.thumbhash } : {})}
          />
        ) : (
          <MasjidTile />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-headline text-text">{name}</span>
          <span className="truncate type-footnote text-text-secondary">{place}</span>
        </span>
        <CaretRightIcon size={20} className="shrink-0 text-text-secondary rtl:-scale-x-100" />
      </Pressable>
      {children}
    </Card>
  );
}
